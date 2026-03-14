/**
 * Delivery Partner Controller
 * Handles delivery partner specific operations
 */

const mongoose = require('mongoose');
const logger = require('../utils/logger');
const Order = require('../models/Order');
const User = require('../models/User');
const AreaManager = require('../models/AreaManager');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;

const adjustDeliveryPartnerLoad = async (partnerId, delta) => {
  if (!partnerId || !delta) return;

  const partner = await User.findById(partnerId);
  if (!partner?.deliveryPartner) return;

  const currentLoad = Number(partner.deliveryPartner.currentLoad || 0);
  partner.deliveryPartner.currentLoad = Math.max(0, currentLoad + delta);
  await partner.save();
};

const isAssignedToPartner = (order, userId) => {
  const mine = String(userId);
  return [
    order?.assignedDeliveryPartner,
    order?.deliveryPartner?.id,
    order?.deliveryPartner?.riderId
  ].some((value) => String(value || '') === mine);
};

// ==================== HELPER FUNCTIONS ====================
const getAssignedZonesForDeliveryUser = async (userId) => {
  const assignments = await AreaManager.find({
    manager: userId,
    status: 'active'
  }).populate('deliveryZone');

  return assignments
    .map(assignment => assignment.deliveryZone)
    .filter(Boolean)
    .filter(zone => zone.isActive);
};

// ==================== MY ORDERS (ASSIGNED TO ME) ====================
/**
 * GET /api/delivery/my-orders
 * Get all orders assigned to the logged-in delivery partner
 */
exports.getMyOrders = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20, orderId } = req.query;
    const userId = req.user._id;

    // Build filter
    const filter = {
      $or: [
        { assignedDeliveryPartner: userId },
        { 'deliveryPartner.id': userId },
        { 'deliveryPartner.riderId': userId }
      ]
    };
    const specificOrderId = req.params.id || orderId;
    
    // Filter by status if provided
    if (specificOrderId) {
      filter._id = specificOrderId;
    } else if (status && status !== 'all') {
      filter.status = status;
    } else {
      // By default, show only current delivery orders
      filter.status = { 
        $in: ['confirmed', 'accepted', 'picked_up', 'out_for_delivery'] 
      };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [orders, total] = await Promise.all([
      Order.find(filter)
        .populate('customer', 'name email phone')
        .populate('assignedDeliveryPartner', 'name email phone')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Order.countDocuments(filter)
    ]);

    res.json({
      ok: true,
      orders,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit))
    });
  } catch (error) {
    logger.error('Error fetching my orders:', error);
    next(error);
  }
};

// ==================== UPDATE ORDER STATUS ====================
/**
 * PUT /api/delivery/orders/:id/status
 * Update order status (limited to delivery-related statuses)
 */
exports.updateOrderStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, note } = req.body;
    const userId = req.user._id;

    // Allowed statuses for delivery partner
    const allowedStatuses = ['accepted', 'picked_up', 'out_for_delivery', 'delivered'];
    
    if (!allowedStatuses.includes(status)) {
      return res.status(403).json({
        ok: false,
        error: 'You can only update to: packed, processing, shipped, or delivered'
      });
    }

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ ok: false, error: 'Order not found' });
    }

    // Verify this order is assigned to the delivery partner
    if (!isAssignedToPartner(order, userId)) {
      return res.status(403).json({
        ok: false,
        error: 'This order is not assigned to you'
      });
    }

    // If marking as delivered, require proof of delivery
    if (status === 'delivered' && !order.proofOfDelivery?.photoUrl) {
      return res.status(400).json({
        ok: false,
        error: 'Please upload proof of delivery before marking as delivered'
      });
    }

    // Update status
    order.status = status;
    
    // Add to delivery updates
    order.deliveryUpdates.push({
      status,
      note: note || '',
      updatedBy: userId,
      updatedByRole: 'delivery_partner',
      updatedAt: new Date()
    });

    // Update orderStatus for tracking UI
    const shouldReleaseLoad = status === 'delivered';

    if (status === 'shipped') {
      order.orderStatus = 'OUT_FOR_DELIVERY';
    } else if (status === 'delivered') {
      order.orderStatus = 'DELIVERED';
      order.deliveryStatus = 'Delivered';
      if (!order.proofOfDelivery?.deliveredAt) {
        order.proofOfDelivery = {
          ...order.proofOfDelivery,
          deliveredAt: new Date(),
          deliveredBy: userId
        };
      }
    }

    await order.save();

    if (shouldReleaseLoad) {
      await adjustDeliveryPartnerLoad(userId, -1);
    }

    // Emit socket event (if io is attached to app)
    if (req.app.get('io')) {
      req.app.get('io').emit('order-status-updated', {
        orderId: order._id,
        status: order.status,
        orderStatus: order.orderStatus,
        timestamp: new Date()
      });
    }

    res.json({ ok: true, order });
  } catch (error) {
    logger.error('Error updating order status:', error);
    next(error);
  }
};

// ==================== LOCATION TRACKING ====================
/**
 * POST /api/delivery/location
 * Update delivery partner's current location
 */
exports.updateLocation = async (req, res, next) => {
  try {
    const { lat, lng, orderId, speed, accuracy } = req.body;
    const userId = req.user._id;

    // Validate coordinates
    if (typeof lat !== 'number' || typeof lng !== 'number' ||
        lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid coordinates'
      });
    }

    if (!orderId) {
      return res.status(400).json({
        ok: false,
        error: 'Order ID is required'
      });
    }

    // Find the order
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ ok: false, error: 'Order not found' });
    }

    // Verify assignment
    if (!isAssignedToPartner(order, userId)) {
      return res.status(403).json({
        ok: false,
        error: 'This order is not assigned to you'
      });
    }

    // Add to location history (limit to last 100 points)
    order.deliveryLocationHistory.push({
      lat,
      lng,
      timestamp: new Date(),
      speed: speed || null,
      accuracy: accuracy || null
    });

    // Keep only last 100 locations to prevent database bloat
    if (order.deliveryLocationHistory.length > 100) {
      order.deliveryLocationHistory = order.deliveryLocationHistory.slice(-100);
    }

    // Update current delivery partner location
    if (!order.deliveryPartner) {
      order.deliveryPartner = {};
    }
    order.deliveryPartner.location = { lat, lng };
    order.lastLocationUpdate = new Date();

    await order.save();

    // Emit socket event for real-time tracking
    if (req.app.get('io')) {
      req.app.get('io').to(orderId).emit('partner-location-update', {
        orderId,
        lat,
        lng,
        timestamp: new Date(),
        speed,
        accuracy
      });
    }

    res.json({ 
      ok: true, 
      message: 'Location updated',
      location: { lat, lng, timestamp: new Date() }
    });
  } catch (error) {
    logger.error('Error updating location:', error);
    next(error);
  }
};

// ==================== PROOF OF DELIVERY ====================
/**
 * POST /api/delivery/orders/:id/proof
 * Upload proof of delivery (photo)
 */
exports.uploadProofOfDelivery = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;
    const { notes, signature } = req.body;

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ ok: false, error: 'Order not found' });
    }

    // Verify assignment
    if (!isAssignedToPartner(order, userId)) {
      return res.status(403).json({
        ok: false,
        error: 'This order is not assigned to you'
      });
    }

    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({
        ok: false,
        error: 'Photo is required'
      });
    }

    // Save proof of delivery
    order.proofOfDelivery = {
      photoUrl: `/uploads/delivery-proof/${req.file.filename}`,
      deliveredAt: new Date(),
      deliveredBy: userId,
      signature: signature || '',
      notes: notes || ''
    };

    // Auto-update status to delivered
    const newlyDelivered = order.status !== 'delivered';

    if (newlyDelivered) {
      order.status = 'delivered';
      order.orderStatus = 'DELIVERED';
      order.deliveryStatus = 'Delivered';
      
      order.deliveryUpdates.push({
        status: 'delivered',
        note: 'Proof of delivery uploaded',
        updatedBy: userId,
        updatedByRole: 'delivery_partner',
        updatedAt: new Date()
      });

    }

    await order.save();

    if (newlyDelivered) {
      await adjustDeliveryPartnerLoad(userId, -1);
    }

    // Emit socket event
    if (req.app.get('io')) {
      req.app.get('io').emit('order-delivered', {
        orderId: order._id,
        proofOfDelivery: order.proofOfDelivery,
        timestamp: new Date()
      });
    }

    res.json({ 
      ok: true, 
      message: 'Proof of delivery uploaded successfully',
      order 
    });
  } catch (error) {
    logger.error('Error uploading proof of delivery:', error);
    next(error);
  }
};

// ==================== GET LOCATION HISTORY ====================
/**
 * GET /api/delivery/orders/:id/location-history
 * Get location history for an order
 */
exports.getLocationHistory = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const order = await Order.findById(id)
      .select('deliveryLocationHistory assignedDeliveryPartner')
      .lean();

    if (!order) {
      return res.status(404).json({ ok: false, error: 'Order not found' });
    }

    // Verify assignment
    if (!isAssignedToPartner(order, userId)) {
      return res.status(403).json({
        ok: false,
        error: 'This order is not assigned to you'
      });
    }

    res.json({
      ok: true,
      history: order.deliveryLocationHistory || []
    });
  } catch (error) {
    logger.error('Error fetching location history:', error);
    next(error);
  }
};

// ==================== ACCEPT DELIVERY ====================
/**
 * POST /api/delivery/orders/:id/accept
 * Accept a delivery assignment
 */
exports.acceptDelivery = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ ok: false, error: 'Order not found' });
    }

    // Check if already assigned
    if (order.assignedDeliveryPartner && !isAssignedToPartner(order, userId)) {
      return res.status(400).json({
        ok: false,
        error: 'This order is already assigned to another delivery partner'
      });
    }

    // Get user details
    const user = await User.findById(userId);
    if (!user || !user.roles?.includes('delivery_partner')) {
      return res.status(403).json({
        ok: false,
        error: 'You must be a delivery partner to accept orders'
      });
    }

    // Assign order
    order.assignedDeliveryPartner = userId;
    order.assignedAt = new Date();
    
    // Update deliveryPartner info for tracking
    order.deliveryPartner = {
      id: userId,
      riderId: userId,
      name: user.name || user.email,
      phone: user.phone || '',
      photo: user.profileImage || '',
      rating: 4.8,
      vehicleType: 'bike'
    };

    order.deliveryUpdates.push({
      status: order.status,
      note: 'Delivery accepted by partner',
      updatedBy: userId,
      updatedByRole: 'delivery_partner',
      updatedAt: new Date()
    });

    await order.save();
    await adjustDeliveryPartnerLoad(userId, 1);

    // Emit socket event
    if (req.app.get('io')) {
      req.app.get('io').emit('order-assigned', {
        orderId: order._id,
        deliveryPartner: order.deliveryPartner,
        timestamp: new Date()
      });
    }

    res.json({ ok: true, order });
  } catch (error) {
    logger.error('Error accepting delivery:', error);
    next(error);
  }
};

module.exports = exports;
