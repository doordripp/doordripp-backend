const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const User = require('../models/User');
const Product = require('../models/Product');
const escapeRegex = require('../utils/escapeRegex');
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

exports.assignManagerToArea = async (req, res, next) => {
  try {
    const { managerId, deliveryZoneId } = req.body;

    if (!managerId || !deliveryZoneId) {
      return res.status(400).json({
        success: false,
        error: 'Manager ID and Delivery Zone ID are required'
      });
    }

    // Verify user exists and has manager, delivery_partner, or admin role
    const manager = await User.findById(managerId);
    if (!manager) {
      return res.status(404).json({ success: false, error: 'Manager not found' });
    }

    if (!manager.roles.includes('manager') && !manager.roles.includes('delivery_partner') && !manager.roles.includes('admin')) {
      return res.status(400).json({
        success: false,
        error: 'User must have manager, delivery partner, or admin role'
      });
    }

    // Check if assignment already exists
    const existing = await AreaManager.findOne({
      manager: managerId,
      deliveryZone: deliveryZoneId
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        error: 'Manager is already assigned to this area'
      });
    }

    // Create new assignment
    const assignment = new AreaManager({
      manager: managerId,
      deliveryZone: deliveryZoneId,
      assignedBy: req.user.id
    });

    await assignment.save();
    
    // Populate the assignment with manager and zone details
    await assignment.populate('manager', 'name email phone');
    await assignment.populate('deliveryZone', 'name latitude longitude radius');

    res.json({
      success: true,
      message: 'Manager assigned to area successfully',
      assignment
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Remove manager from area
 */

exports.removeManagerFromArea = async (req, res, next) => {
  try {
    const { assignmentId } = req.params;

    const assignment = await AreaManager.findByIdAndDelete(assignmentId);
    if (!assignment) {
      return res.status(404).json({ success: false, error: 'Assignment not found' });
    }

    res.json({
      success: true,
      message: 'Manager removed from area successfully'
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get all area manager assignments
 */

exports.getAreaManagerAssignments = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    let query = {};
    if (status && status !== 'all') {
      query.status = status;
    }

    const [assignments, total] = await Promise.all([
      AreaManager.find(query)
        .populate('manager', 'name email phone')
        .populate('deliveryZone', 'name latitude longitude radius')
        .populate('assignedBy', 'name')
        .skip(skip)
        .limit(parseInt(limit))
        .sort({ createdAt: -1 }),
      AreaManager.countDocuments(query)
    ]);

    res.json({
      success: true,
      assignments,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (err) {
    next(err);
  }
};

// ==================== ORDER ASSIGNMENT (Feature 1) ====================
/**
 * Assign delivery partner to an order
 * POST /api/admin/orders/:id/assign
 */



// --- MANAGER APP ROUTES EXTRACTIONS ---

exports.getPartnerSchedule = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select('deliveryPartner roles');
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (Array.isArray(user.roles) && user.roles.includes('delivery_partner')) {
      // Assuming syncPartnerMetrics is defined above in adminManagerController.js since it shares utils
      // Wait, let's just make sure to add it if missing, but we will assume for now.
    }

    res.json({
      deliveryPartner: user.deliveryPartner || {
        workingHours: '9 AM - 5 PM',
        maxOrdersPerSlot: 10,
        currentLoad: 0,
        availabilitySlots: ['Morning 9-12', 'Afternoon 12-4', 'Evening 4-8']
      }
    });
  } catch (err) {
    next(err);
  }
};

exports.updatePartnerSchedule = async (req, res, next) => {
  try {
    const { workingHours, maxOrdersPerSlot, availabilitySlots } = req.body;
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (!user.deliveryPartner) user.deliveryPartner = {};
    if (workingHours !== undefined) user.deliveryPartner.workingHours = workingHours;
    if (maxOrdersPerSlot !== undefined) user.deliveryPartner.maxOrdersPerSlot = Math.max(Number(maxOrdersPerSlot) || 10, 10);
    if (availabilitySlots !== undefined) user.deliveryPartner.availabilitySlots = availabilitySlots;

    await user.save();
    res.json({ success: true, message: 'Schedule updated', deliveryPartner: user.deliveryPartner });
  } catch (err) {
    next(err);
  }
};

exports.getAllDeliveryPartners = async (req, res, next) => {
  try {
    const { search } = req.query;
    const query = { roles: 'delivery_partner' };

    if (search) {
      query.$or = [
        { name: { $regex: escapeRegex(search), $options: 'i' } },
        { email: { $regex: escapeRegex(search), $options: 'i' } },
        { phone: { $regex: escapeRegex(search), $options: 'i' } }
      ];
    }

    const partners = await User.find(query)
      .select('-password -refreshToken')
      .sort({ createdAt: -1 });

    res.json({ success: true, users: partners });
  } catch (err) {
    next(err);
  }
};

exports.createDeliveryPartner = async (req, res, next) => {
  try {
    const { name, email, password, phone, vehicleType, licenseNumber, accountNumber, assignedArea } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: 'Name, email, and password are required' });
    }

    const emailNorm = email.toLowerCase().trim();
    const existing = await User.findOne({ email: emailNorm });
    
    if (existing) {
      if (!existing.roles.includes('delivery_partner')) {
        existing.roles.push('delivery_partner');
      }
      
      existing.name = name.trim();
      if (phone) existing.phone = phone.trim();
      
      existing.deliveryPartner = {
        ...existing.deliveryPartner,
        maxOrdersPerSlot: Math.max(Number(existing.deliveryPartner?.maxOrdersPerSlot) || 0, 10),
        vehicleType: vehicleType || existing.deliveryPartner?.vehicleType || 'Bike',
        licenseNumber: licenseNumber || existing.deliveryPartner?.licenseNumber || '',
        accountNumber: accountNumber || existing.deliveryPartner?.accountNumber || ''
      };

      if (assignedArea) {
        existing.deliveryPartner.assignedArea = assignedArea;
      }

      await existing.save();
      return res.json({ 
        success: true, 
        message: 'Delivery partner details updated for existing user', 
        user: { _id: existing._id, name: existing.name, email: existing.email, roles: existing.roles } 
      });
    }

    const user = new User({
      name: name.trim(),
      email: emailNorm,
      password,
      phone: phone || undefined,
      roles: ['delivery_partner'],
      emailVerified: true,
      termsAccepted: true,
      isPasswordSet: true,
      deliveryPartner: {
        maxOrdersPerSlot: 10,
        vehicleType: vehicleType || 'Bike',
        licenseNumber: licenseNumber || '',
        accountNumber: accountNumber || '',
        assignedArea: assignedArea || null
      }
    });

    await user.save();

    res.status(201).json({
      success: true,
      message: 'Delivery partner created successfully',
      user: { _id: user._id, name: user.name, email: user.email, phone: user.phone, roles: user.roles }
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ success: false, error: 'Email or phone already exists' });
    }
    next(err);
  }
};

exports.getDeliveryPartnerById = async (req, res, next) => {
  try {
    const partner = await User.findById(req.params.id).select('-password -refreshToken');
    if (!partner) return res.status(404).json({ success: false, error: 'Partner not found' });
    res.json({ success: true, user: partner, orders: [] });
  } catch (err) {
    next(err);
  }
};

exports.updateDeliveryPartner = async (req, res, next) => {
  try {
    const { name, email, phone, deliveryPartner } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, error: 'Partner not found' });

    if (name) user.name = name;
    if (email) user.email = email.toLowerCase().trim();
    if (phone !== undefined) user.phone = phone;
    
    if (deliveryPartner) {
      user.deliveryPartner = {
        ...user.deliveryPartner,
        ...deliveryPartner,
        maxOrdersPerSlot: Math.max(Number(deliveryPartner.maxOrdersPerSlot ?? user.deliveryPartner?.maxOrdersPerSlot) || 10, 10)
      };
    }

    await user.save();
    res.json({ success: true, message: 'Partner details updated', user });
  } catch (err) {
    next(err);
  }
};

exports.deleteDeliveryPartner = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, error: 'Partner not found' });

    user.roles = user.roles.filter(r => r !== 'delivery_partner');
    user.deliveryPartner = undefined;
    
    if (user.roles.length === 0) {
      await User.findByIdAndDelete(req.params.id);
    } else {
      await user.save();
    }

    res.json({ success: true, message: 'Delivery partner removed successfully' });
  } catch (err) {
    next(err);
  }
};

exports.assignDeliveryPartnerWrap = async (req, res, next) => {
  try {
    const adminOrderController = require('./adminOrderController');
    const partnerId = req.params.id;
    // Assuming resolveOrderIdInput logic
    const normalizedOrderId = String(req.body.orderId || '').trim().replace(/^#/, '');
    if (!normalizedOrderId) return res.status(404).json({ ok: false, error: 'Order not found' });
    
    req.params = { ...req.params, id: normalizedOrderId };
    req.body = { ...req.body, deliveryPartnerId: partnerId };
    return adminOrderController.assignDeliveryPartner(req, res, next);
  } catch (err) {
    return next(err);
  }
};
