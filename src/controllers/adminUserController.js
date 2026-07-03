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

exports.listUsers = async (req, res, next) => {
  try {
    const { search, page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const filter = {};
    if (search) {
      filter.$or = [
        { name: new RegExp(escapeRegex(search), 'i') },
        { email: new RegExp(escapeRegex(search), 'i') }
      ];
    }

    const [users, total] = await Promise.all([
      User.find(filter, '-password -refreshToken')
        .skip(skip)
        .limit(parseInt(limit))
        .sort({ createdAt: -1 }),
      User.countDocuments(filter)
    ]);

    // Get order counts for each user
    const userIds = users.map(u => u._id);
    const orderCounts = await Order.aggregate([
      { $match: { customer: { $in: userIds } } },
      { $group: { _id: '$customer', count: { $sum: 1 } } }
    ]);
    const orderCountMap = orderCounts.reduce((acc, item) => {
      acc[item._id.toString()] = item.count;
      return acc;
    }, {});

    const formattedUsers = users.map(user => ({
      id: user._id,
      _id: user._id,
      name: user.name,
      email: user.email,
      roles: user.roles || [],
      blocked: user.blocked,
      createdAt: user.createdAt,
      ordersCount: orderCountMap[user._id.toString()] || 0
    }));

    res.json({
      users: formattedUsers,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit))
    });
  } catch (err) {
    next(err);
  }
};


exports.getUser = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id, '-password -refreshToken');
    if (!user) return res.status(404).json({ error: 'User not found' });

    const orders = await Order.find({ customer: user._id })
      .sort({ createdAt: -1 })
      .limit(10);

    res.json({
      id: user._id,
      _id: user._id,
      name: user.name,
      email: user.email,
      roles: user.roles || [],
      blocked: user.blocked,
      createdAt: user.createdAt,
      orders
    });
  } catch (err) {
    next(err);
  }
};


exports.updateUser = async (req, res, next) => {
  try {
    const id = req.params.id || req.params.userId;
    const { name, email, roles, blocked } = req.body;

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (email !== undefined) updateData.email = email;
    if (roles !== undefined) updateData.roles = normalizeStoredRoles(roles);
    if (blocked !== undefined) updateData.blocked = blocked;

    const user = await User.findByIdAndUpdate(id, updateData, { returnDocument: 'after' }).select('-password -refreshToken');
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({
      id: user._id,
      _id: user._id,
      name: user.name,
      email: user.email,
      roles: user.roles || [],
      blocked: user.blocked,
      createdAt: user.createdAt
    });
  } catch (err) {
    next(err);
  }
};


exports.deleteUser = async (req, res, next) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id || req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true, message: 'User deleted successfully' });
  } catch (err) {
    next(err);
  }
};

// ==================== REPORTS ====================

exports.getAllUsers = async (req, res, next) => {
  try {
    const { search, role, status, page = 1, limit = 20 } = req.query;
    const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
    const wantsAllUsers = String(limit).toLowerCase() === 'all';
    const parsedLimit = wantsAllUsers ? null : Math.max(parseInt(limit, 10) || 20, 1);
    const skip = parsedLimit ? (parsedPage - 1) * parsedLimit : 0;

    const conditions = [];

    if (search) {
      conditions.push({
        $or: [
          { name: { $regex: escapeRegex(search), $options: 'i' } },
          { email: { $regex: escapeRegex(search), $options: 'i' } },
          { phone: { $regex: escapeRegex(search), $options: 'i' } }
        ]
      });
    }

    if (role && role !== 'all') {
      if (role === 'customer') {
        conditions.push({
          $or: [
            { roles: { $exists: false } },
            { roles: null },
            { roles: { $size: 0 } },
            { roles: 'customer' }
          ]
        });
      } else {
        conditions.push({ roles: role });
      }
    }

    if (status === 'banned') {
      conditions.push({ isBanned: true });
    } else if (status === 'active') {
      conditions.push({ isBanned: false });
    }

    const query = conditions.length ? { $and: conditions } : {};

    const [users, total] = await Promise.all([
      (() => {
        const userQuery = User.find(query)
          .select('-password -resetPasswordToken')
          .sort({ createdAt: -1 });

        if (parsedLimit) {
          userQuery.skip(skip).limit(parsedLimit);
        }

        return userQuery;
      })(),
      User.countDocuments(query)
    ]);

    res.json({
      success: true,
      users,
      pagination: {
        total,
        page: parsedPage,
        limit: parsedLimit || total,
        pages: parsedLimit ? Math.ceil(total / parsedLimit) : (total > 0 ? 1 : 0)
      }
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get user details by ID
 */

exports.getUserDetails = async (req, res, next) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId)
      .select('-password')
      .populate('managerFor', 'name latitude longitude')
      .exec();

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Get area manager assignments if user handles delivery areas
    let areaAssignments = [];
    if (user.roles.includes('manager') || user.roles.includes('delivery_partner')) {
      areaAssignments = await AreaManager.find({ manager: userId })
        .populate('deliveryZone', 'name latitude longitude radius')
        .sort({ createdAt: -1 });
    }

    // Get user orders
    const orders = await Order.find({ customer: userId })
      .select('_id items total status createdAt')
      .limit(10)
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      user,
      areaAssignments,
      orders,
      stats: {
        totalOrders: await Order.countDocuments({ customer: userId }),
        totalSpent: (await Order.aggregate([
          { $match: { customer: mongoose.Types.ObjectId(userId) } },
          { $group: { _id: null, total: { $sum: '$total' } } }
        ]))[0]?.total || 0
      }
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Change user role(s)
 */

exports.changeUserRole = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const normalizedRoles = normalizeStoredRoles(req.body.roles || []);

    if (String(req.user.id) === String(userId)) {
      if (!normalizedRoles.includes('admin') && req.user.roles?.includes('admin')) {
        return res.status(403).json({ success: false, error: 'You cannot remove your own admin role.' });
      }
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    user.roles = normalizedRoles;
    await user.save();

    res.json({
      success: true,
      message: 'User roles updated successfully',
      user
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Ban user
 */

exports.banUser = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { reason } = req.body;

    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Ban reason is required' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    user.isBanned = true;
    user.banReason = reason;
    user.bannedAt = new Date();
    user.bannedBy = req.user.id;
    await user.save();

    // If user handles delivery areas, deactivate their assignments
    if (user.roles.includes('manager') || user.roles.includes('delivery_partner')) {
      await AreaManager.updateMany(
        { manager: userId },
        { status: 'suspended' }
      );
    }

    res.json({
      success: true,
      message: 'User banned successfully',
      user
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Unban user
 */

exports.unbanUser = async (req, res, next) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    user.isBanned = false;
    user.banReason = null;
    user.bannedAt = null;
    user.bannedBy = null;
    await user.save();

    // If user handles delivery areas, reactivate their assignments
    if (user.roles.includes('manager') || user.roles.includes('delivery_partner')) {
      await AreaManager.updateMany(
        { manager: userId },
        { status: 'active' }
      );
    }

    res.json({
      success: true,
      message: 'User unbanned successfully',
      user
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Assign manager to delivery area
 */

