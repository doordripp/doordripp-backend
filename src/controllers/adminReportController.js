const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const User = require('../models/User');
const Product = require('../models/Product');
const Order = require('../models/Order');
const AreaManager = require('../models/AreaManager');
const { hasAnyRole } = require('../middleware/auth');
const { getOrderTrackUrl } = require('../utils/appUrls');
const { buildProductInventoryPayload, normalizeSizeInventory } = require('../utils/productInventory');

const CURRENT_DELIVERY_ORDER_STATUSES = ['confirmed', 'accepted', 'picked_up', 'out_for_delivery'];
const STATUS_TO_DELIVERY_STATUS = {
  confirmed: 'confirmed',
  accepted: 'accepted',
  picked_up: 'picked_up',
  out_for_delivery: 'out_for_delivery',
  delivered: 'delivered',
  failed: 'failed',
  cancelled: 'cancelled'
};

const forwardAdminError = (next, res, err, fallbackMessage = 'Internal server error') => {
  if (typeof next === 'function') {
    return next(err);
  }

  logger.error('Admin controller fallback error:', err);
  if (res && !res.headersSent) {
    return res.status(err?.status || 500).json({
      error: err?.message || fallbackMessage
    });
  }

  return null;
};

const normalizeProductDetails = (details) => {
  if (!details) return {};
  if (details instanceof Map) return Object.fromEntries(details);
  if (typeof details.toObject === 'function') return details.toObject();
  return details;
};

const normalizeProductKeyFeatures = (keyFeatures) => {
  if (!keyFeatures) return [];
  if (Array.isArray(keyFeatures)) return keyFeatures;
  if (typeof keyFeatures === 'string') {
    try {
      const parsed = JSON.parse(keyFeatures);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return keyFeatures
        .split('\n')
        .map(feature => feature.trim())
        .filter(Boolean);
    }
  }
  return [];
};

const formatProductResponse = (product, extra = {}) => {
  const inventory = buildProductInventoryPayload(product);

  return {
    id: product._id,
    _id: product._id,
    name: product.name,
    slug: product.slug,
    description: product.description,
    price: product.price,
    originalPrice: product.originalPrice,
    discount: product.discount,
    costPrice: product.costPrice,
    deliveryCost: product.deliveryCost,
    pricingMode: product.pricingMode,
    gstRate: product.gstRate,
    stock: inventory.stock,
    category: product.category,
    subcategory: product.subcategory,
    dressStyle: product.dressStyle,
    images: product.images || [],
    colors: product.colors || [],
    sizes: inventory.sizes,
    sizeInventory: inventory.sizeInventory,
    availableSizes: inventory.availableSizes,
    defaultSize: inventory.defaultSize,
    rating: product.rating || { rating: 4.5, reviews: 0 },
    isNewArrival: product.isNewArrival || false,
    isBestSeller: product.isBestSeller || false,
    isFeatured: product.isFeatured || false,
    productSource: product.productSource || 'Manufacturer',
    listedBy: toListedByPayload(product.listedBy),
    details: normalizeProductDetails(product.details),
    keyFeatures: normalizeProductKeyFeatures(product.keyFeatures),
    status: inventory.inStock ? 'Active' : 'Out of Stock',
    ...extra
  };
};

const normalizeProductImages = (images) => {
  if (!Array.isArray(images)) return [];
  return images
    .filter(image => typeof image === 'string')
    .map(image => image.trim())
    .filter(Boolean);
};

const toListedByPayload = (listedBy) => {
  if (!listedBy) return null;

  if (typeof listedBy === 'object' && listedBy.name) {
    return {
      id: listedBy._id || listedBy.id,
      name: listedBy.name,
      email: listedBy.email || ''
    };
  }

  return {
    id: listedBy,
    name: '',
    email: ''
  };
};

const parseCoordinate = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = parseFloat(value);
  return Number.isNaN(parsed) ? null : parsed;
};

const isOrderInAnyAssignedZone = (order, assignedZones) => {
  const lat = parseCoordinate(order?.shippingAddress?.latitude);
  const lng = parseCoordinate(order?.shippingAddress?.longitude);

  if (lat === null || lng === null || !Array.isArray(assignedZones) || assignedZones.length === 0) {
    return false;
  }

  return assignedZones.some(zone => {
    if (!zone || !zone.isActive || typeof zone.containsPoint !== 'function') return false;
    return zone.containsPoint(lat, lng);
  });
};

const getAssignedZonesForDeliveryUser = async (userId) => {
  const [assignments, user] = await Promise.all([
    AreaManager.find({
      manager: userId,
      status: 'active'
    }).populate('deliveryZone'),
    User.findById(userId)
      .select('deliveryPartner.assignedArea')
      .populate('deliveryPartner.assignedArea')
  ]);

  const zones = assignments
    .map(assignment => assignment.deliveryZone)
    .filter(Boolean)
    .filter(zone => zone.isActive);

  if (user?.deliveryPartner?.assignedArea?.isActive) {
    zones.push(user.deliveryPartner.assignedArea);
  }

  return zones.filter((zone, index, list) => (
    list.findIndex(candidate => String(candidate?._id) === String(zone?._id)) === index
  ));
};

const buildDeliveryPartnerSnapshot = (partner) => ({
  id: partner._id,
  riderId: partner._id,
  name: partner.name || partner.email,
  phone: partner.phone || partner.phoneNumber || '',
  photo: partner.profileImage || partner.profilePhoto || partner.avatar || '',
  rating: partner.rating || 4.8,
  vehicleType: partner.deliveryPartner?.vehicleType || partner.vehicleType || 'Bike'
});

const adjustDeliveryPartnerLoad = async (partnerId, delta) => {
  if (!partnerId || !delta) return;

  const partner = await User.findById(partnerId);
  if (!partner?.deliveryPartner) return;

  const currentLoad = Number(partner.deliveryPartner.currentLoad || 0);
  partner.deliveryPartner.currentLoad = Math.max(0, currentLoad + delta);
  await partner.save();
};

const isAssignedToPartner = (order, userId) => {
  const me = String(userId);
  const assigned = order?.assignedDeliveryPartner ? String(order.assignedDeliveryPartner) : null;
  const dpId = order?.deliveryPartner?.id ? String(order.deliveryPartner.id) : null;
  const legacyDpId = order?.deliveryPartner?.riderId ? String(order.deliveryPartner.riderId) : null;
  return assigned === me || dpId === me || legacyDpId === me;
};

const hasAnyAssignedPartner = (order) => {
  return Boolean(order?.assignedDeliveryPartner || order?.deliveryPartner?.id || order?.deliveryPartner?.riderId);
};

const MANAGEABLE_ROLES = ['admin', 'manager', 'delivery_partner'];

const normalizeStoredRoles = (roles = []) => {
  const roleArray = Array.isArray(roles) ? roles : [roles];
  return Array.from(new Set(
    roleArray
      .filter(Boolean)
      .map(role => String(role).toLowerCase().trim())
      .filter(role => MANAGEABLE_ROLES.includes(role))
  ));
};

// ==================== DASHBOARD STATS ====================

exports.getBestSellers = async (req, res, next) => {
  try {
    const bestSellers = await Order.aggregate([
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.name',
          sales: { $sum: '$items.quantity' },
          revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } }
        }
      },
      { $sort: { sales: -1 } },
      { $limit: 10 },
      {
        $project: {
          name: '$_id',
          sales: 1,
          revenue: 1,
          _id: 0
        }
      }
    ]);

    res.json(bestSellers);
  } catch (err) {
    next(err);
  }
};

// ==================== REPORT STATS ====================

exports.getReportStats = async (req, res, next) => {
  try {
    // 1. Total Revenue — sum of totals from non-cancelled/non-failed orders
    const revenueOrders = await Order.find(
      { status: { $nin: ['cancelled', 'failed'] } },
      'total items status'
    );
    const totalRevenue = revenueOrders.reduce((sum, o) => sum + (Number(o.total) || 0), 0);

    // 2. Total Orders — only confirmed, accepted, picked_up, out_for_delivery, delivered
    const activeStatuses = ['confirmed', 'accepted', 'picked_up', 'out_for_delivery', 'delivered'];
    const totalOrders = await Order.countDocuments({ status: { $in: activeStatuses } });

    // 3. Average Order Value
    const aov = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    // 4. Total Returns — cancelled + failed
    const totalReturns = await Order.countDocuments({ status: { $in: ['cancelled', 'failed'] } });

    // 5. Per-product revenue breakdown via aggregation
    const productRevenue = await Order.aggregate([
      { $match: { status: { $nin: ['cancelled', 'failed'] } } },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.product',
          productName: { $first: '$items.name' },
          unitsSold: { $sum: '$items.quantity' },
          avgPrice: { $avg: '$items.price' },
          totalRevenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } }
        }
      },
      { $sort: { totalRevenue: -1 } }
    ]);

    // Enrich with current stock and price from Product collection
    const productIds = productRevenue
      .map(p => p._id)
      .filter(Boolean);

    const products = await Product.find(
      { _id: { $in: productIds } },
      'name price stock'
    );

    const productMap = products.reduce((acc, p) => {
      acc[p._id.toString()] = p;
      return acc;
    }, {});

    const productRevenueList = productRevenue.map(item => {
      const prod = item._id ? productMap[item._id.toString()] : null;
      return {
        productId: item._id ? item._id.toString() : null,
        name: prod?.name || item.productName || 'Unknown Product',
        price: prod?.price ?? item.avgPrice ?? 0,
        unitsSold: item.unitsSold || 0,
        stockRemaining: prod?.stock ?? 0,
        totalRevenue: item.totalRevenue || 0
      };
    });

    res.json({
      totalRevenue,
      aov,
      totalOrders,
      totalReturns,
      productRevenue: productRevenueList
    });
  } catch (err) {
    next(err);
  }
};

// ==================== USER MANAGEMENT ====================

/**
 * Get all users with filtering and search
 */

