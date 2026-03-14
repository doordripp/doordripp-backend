/**
 * Delivery Analytics Controller
 * Provides comprehensive analytics for delivery operations
 */

const mongoose = require('mongoose');
const logger = require('../utils/logger');
const Order = require('../models/Order');
const User = require('../models/User');
const DeliveryZone = require('../models/DeliveryZone');

/**
 * GET /api/admin/delivery-analytics
 * Get comprehensive delivery analytics
 */
exports.getDeliveryAnalytics = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    
    // Date range filter
    let dateFilter = {};
    if (startDate || endDate) {
      dateFilter.createdAt = {};
      if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
      if (endDate) dateFilter.createdAt.$lte = new Date(endDate);
    }

    // Get overall order statistics
    const [
      totalOrders,
      deliveredOrders,
      pendingOrders,
      cancelledOrders,
      ordersWithAssignment
    ] = await Promise.all([
      Order.countDocuments(dateFilter),
      Order.countDocuments({ ...dateFilter, status: 'delivered' }),
      Order.countDocuments({ 
        ...dateFilter, 
        status: { $in: ['confirmed', 'accepted', 'picked_up', 'out_for_delivery'] } 
      }),
      Order.countDocuments({ ...dateFilter, status: 'cancelled' }),
      Order.countDocuments({ ...dateFilter, assignedDeliveryPartner: { $exists: true, $ne: null } })
    ]);

    // Calculate average delivery time
    const deliveryTimeStats = await Order.aggregate([
      {
        $match: {
          ...dateFilter,
          status: 'delivered',
          'proofOfDelivery.deliveredAt': { $exists: true }
        }
      },
      {
        $project: {
          deliveryTime: {
            $divide: [
              { $subtract: ['$proofOfDelivery.deliveredAt', '$createdAt'] },
              1000 * 60 // Convert to minutes
            ]
          }
        }
      },
      {
        $group: {
          _id: null,
          avgDeliveryTime: { $avg: '$deliveryTime' },
          minDeliveryTime: { $min: '$deliveryTime' },
          maxDeliveryTime: { $max: '$deliveryTime' }
        }
      }
    ]);

    const avgDeliveryTime = deliveryTimeStats[0]?.avgDeliveryTime || 0;
    const avgDeliveryTimeFormatted = formatMinutes(avgDeliveryTime);

    // Get top delivery partners by completed deliveries
    const topPartners = await Order.aggregate([
      {
        $match: {
          ...dateFilter,
          status: 'delivered',
          assignedDeliveryPartner: { $exists: true, $ne: null }
        }
      },
      {
        $group: {
          _id: '$assignedDeliveryPartner',
          deliveries: { $sum: 1 },
          totalRevenue: { $sum: '$total' }
        }
      },
      { $sort: { deliveries: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'partner'
        }
      },
      {
        $unwind: '$partner'
      },
      {
        $project: {
          name: '$partner.name',
          email: '$partner.email',
          deliveries: 1,
          totalRevenue: 1,
          avgOrderValue: { $divide: ['$totalRevenue', '$deliveries'] }
        }
      }
    ]);

    // Deliveries today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const deliveriesToday = await Order.countDocuments({
      status: 'delivered',
      'proofOfDelivery.deliveredAt': {
        $gte: todayStart,
        $lte: todayEnd
      }
    });

    // Orders by status breakdown
    const ordersByStatus = await Order.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const statusBreakdown = ordersByStatus.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {});

    // Delivery partner performance (success rate)
    const partnerPerformance = await Order.aggregate([
      {
        $match: {
          ...dateFilter,
          assignedDeliveryPartner: { $exists: true, $ne: null }
        }
      },
      {
        $group: {
          _id: '$assignedDeliveryPartner',
          totalAssigned: { $sum: 1 },
          delivered: {
            $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] }
          },
          cancelled: {
            $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] }
          }
        }
      },
      {
        $project: {
          totalAssigned: 1,
          delivered: 1,
          cancelled: 1,
          successRate: {
            $multiply: [
              { $divide: ['$delivered', '$totalAssigned'] },
              100
            ]
          }
        }
      },
      { $sort: { successRate: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'partner'
        }
      },
      {
        $unwind: '$partner'
      },
      {
        $project: {
          name: '$partner.name',
          email: '$partner.email',
          totalAssigned: 1,
          delivered: 1,
          cancelled: 1,
          successRate: 1
        }
      }
    ]);

    // Orders by delivery zone (slowest zones)
    const zoneStats = await Order.aggregate([
      {
        $match: {
          ...dateFilter,
          status: 'delivered',
          'proofOfDelivery.deliveredAt': { $exists: true },
          'shippingAddress.latitude': { $exists: true },
          'shippingAddress.longitude': { $exists: true }
        }
      },
      {
        $project: {
          deliveryTime: {
            $divide: [
              { $subtract: ['$proofOfDelivery.deliveredAt', '$createdAt'] },
              1000 * 60
            ]
          },
          lat: '$shippingAddress.latitude',
          lng: '$shippingAddress.longitude'
        }
      }
    ]);

    // Map orders to zones
    const zones = await DeliveryZone.find({ isActive: true });
    const zoneDeliveryTimes = {};

    zoneStats.forEach(order => {
      zones.forEach(zone => {
        if (zone.containsPoint && zone.containsPoint(order.lat, order.lng)) {
          if (!zoneDeliveryTimes[zone.name]) {
            zoneDeliveryTimes[zone.name] = {
              zoneName: zone.name,
              times: [],
              zoneId: zone._id
            };
          }
          zoneDeliveryTimes[zone.name].times.push(order.deliveryTime);
        }
      });
    });

    const slowestZones = Object.values(zoneDeliveryTimes)
      .map(zone => ({
        zone: zone.zoneName,
        zoneId: zone.zoneId,
        avgTime: zone.times.reduce((a, b) => a + b, 0) / zone.times.length,
        avgTimeFormatted: formatMinutes(
          zone.times.reduce((a, b) => a + b, 0) / zone.times.length
        ),
        orderCount: zone.times.length
      }))
      .sort((a, b) => b.avgTime - a.avgTime)
      .slice(0, 10);

    // Fastest zones
    const fastestZones = Object.values(zoneDeliveryTimes)
      .map(zone => ({
        zone: zone.zoneName,
        zoneId: zone.zoneId,
        avgTime: zone.times.reduce((a, b) => a + b, 0) / zone.times.length,
        avgTimeFormatted: formatMinutes(
          zone.times.reduce((a, b) => a + b, 0) / zone.times.length
        ),
        orderCount: zone.times.length
      }))
      .sort((a, b) => a.avgTime - b.avgTime)
      .slice(0, 10);

    // Hourly order distribution
    const hourlyDistribution = await Order.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: { $hour: '$createdAt' },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Daily trends (last 7 days)
    const last7Days = new Date();
    last7Days.setDate(last7Days.getDate() - 7);

    const dailyTrends = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: last7Days }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
          },
          totalOrders: { $sum: 1 },
          delivered: {
            $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] }
          },
          revenue: { $sum: '$total' }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Response
    res.json({
      ok: true,
      summary: {
        totalOrders,
        deliveredOrders,
        pendingOrders,
        cancelledOrders,
        ordersWithAssignment,
        deliveriesToday,
        deliveryRate: totalOrders > 0 ? ((deliveredOrders / totalOrders) * 100).toFixed(2) + '%' : '0%',
        assignmentRate: totalOrders > 0 ? ((ordersWithAssignment / totalOrders) * 100).toFixed(2) + '%' : '0%'
      },
      performance: {
        avgDeliveryTime: avgDeliveryTimeFormatted,
        avgDeliveryTimeMinutes: Math.round(avgDeliveryTime),
        minDeliveryTime: formatMinutes(deliveryTimeStats[0]?.minDeliveryTime || 0),
        maxDeliveryTime: formatMinutes(deliveryTimeStats[0]?.maxDeliveryTime || 0)
      },
      topPartners,
      partnerPerformance,
      zones: {
        slowest: slowestZones,
        fastest: fastestZones
      },
      statusBreakdown,
      hourlyDistribution,
      dailyTrends
    });
  } catch (error) {
    logger.error('Error fetching delivery analytics:', error);
    next(error);
  }
};

/**
 * GET /api/admin/partner/:partnerId/stats
 * Get stats for a specific delivery partner
 */
exports.getPartnerStats = async (req, res, next) => {
  try {
    const { partnerId } = req.params;
    const { startDate, endDate } = req.query;

    // Verify partner exists
    const partner = await User.findById(partnerId);
    if (!partner) {
      return res.status(404).json({ ok: false, error: 'Partner not found' });
    }

    // Date filter
    let dateFilter = { assignedDeliveryPartner: partnerId };
    if (startDate || endDate) {
      dateFilter.createdAt = {};
      if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
      if (endDate) dateFilter.createdAt.$lte = new Date(endDate);
    }

    // Get partner statistics
    const [
      totalAssigned,
      delivered,
      inProgress,
      cancelled,
      recentOrders
    ] = await Promise.all([
      Order.countDocuments(dateFilter),
      Order.countDocuments({ ...dateFilter, status: 'delivered' }),
      Order.countDocuments({ 
        ...dateFilter, 
        status: { $in: ['accepted', 'picked_up', 'out_for_delivery'] } 
      }),
      Order.countDocuments({ ...dateFilter, status: 'cancelled' }),
      Order.find(dateFilter)
        .populate('customer', 'name email')
        .sort({ createdAt: -1 })
        .limit(10)
    ]);

    // Calculate earnings
    const earnings = await Order.aggregate([
      { $match: { ...dateFilter, status: 'delivered' } },
      {
        $group: {
          _id: null,
          totalEarnings: { $sum: '$deliveryFee' },
          totalRevenue: { $sum: '$total' }
        }
      }
    ]);

    // Delivery time stats
    const deliveryTimeStats = await Order.aggregate([
      {
        $match: {
          ...dateFilter,
          status: 'delivered',
          'proofOfDelivery.deliveredAt': { $exists: true }
        }
      },
      {
        $project: {
          deliveryTime: {
            $divide: [
              { $subtract: ['$proofOfDelivery.deliveredAt', '$createdAt'] },
              1000 * 60
            ]
          }
        }
      },
      {
        $group: {
          _id: null,
          avgDeliveryTime: { $avg: '$deliveryTime' }
        }
      }
    ]);

    const successRate = totalAssigned > 0 
      ? ((delivered / totalAssigned) * 100).toFixed(2) + '%'
      : '0%';

    res.json({
      ok: true,
      partner: {
        id: partner._id,
        name: partner.name,
        email: partner.email,
        phone: partner.phone || partner.phoneNumber
      },
      stats: {
        totalAssigned,
        delivered,
        inProgress,
        cancelled,
        successRate,
        avgDeliveryTime: formatMinutes(deliveryTimeStats[0]?.avgDeliveryTime || 0),
        totalEarnings: earnings[0]?.totalEarnings || 0,
        totalRevenue: earnings[0]?.totalRevenue || 0
      },
      recentOrders
    });
  } catch (error) {
    logger.error('Error fetching partner stats:', error);
    next(error);
  }
};

// ==================== HELPER FUNCTIONS ====================
function formatMinutes(minutes) {
  if (!minutes || minutes < 0) return '0 minutes';
  
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  
  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  return `${mins} minutes`;
}

module.exports = exports;
