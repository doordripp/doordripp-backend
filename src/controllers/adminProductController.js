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

exports.listProducts = async (req, res, next) => {
  try {
    const { search, category, page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const filter = {};
    // Delegate to search service for intelligent search
    if (search) {
      const searchService = require('../services/searchService')
      const searchResults = await searchService.search(search, {
        category: category || 'All',
        sort: 'newest',
        page: parseInt(page),
        limit: parseInt(limit)
      })
      // Reformat to match admin response shape
      return res.json({
        products: searchResults.data || [],
        total: searchResults.total,
        page: searchResults.page,
        totalPages: searchResults.totalPages
      })
    }
    if (category && category !== 'All') {
      const catLower = category.toLowerCase();
      if (catLower === 'men') {
        filter.category = { $regex: /^(men|both|unisex|both \(men & women\))$/i };
      } else if (catLower === 'women') {
        filter.category = { $regex: /^(women|both|unisex|both \(men & women\))$/i };
      } else if (catLower === 'both' || catLower.includes('both')) {
        filter.category = { $regex: /^(both|unisex|both \(men & women\))$/i };
      } else {
        filter.category = new RegExp(`^${escapeRegex(category)}$`, 'i');
      }
    }

    const [products, total] = await Promise.all([
      Product.find(filter)
        .populate('listedBy', 'name email')
        .skip(skip)
        .limit(parseInt(limit))
        .sort({ createdAt: -1 }),
      Product.countDocuments(filter)
    ]);

    const formattedProducts = products.map((p) => formatProductResponse(p));

    res.json({
      products: formattedProducts,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit))
    });
  } catch (err) {
    return forwardAdminError(next, res, err, 'Failed to update product');
  }
};


exports.getProduct = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id).populate('listedBy', 'name email');
    if (!product) return res.status(404).json({ error: 'Product not found' });

    res.json(formatProductResponse(product));
  } catch (err) {
    next(err);
  }
};


exports.createProduct = async (req, res, next) => {
  try {
    const { 
      name, 
      description, 
      price, 
      originalPrice,
      discount,
      costPrice,
      deliveryCost,
      pricingMode,
      gstRate,
      stock,
      category, 
      subcategory,
      dressStyle,
      images,
      colors,
      sizes,
      sizeInventory,
      rating,
      isNewArrival,
      isBestSeller,
      isFeatured,
      productSource,
      details,
      keyFeatures
    } = req.body;

    // Generate slug
    const slug = name.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') +
      '-' + Date.now().toString(36);

    const normalizedSizeInventory = normalizeSizeInventory(sizeInventory, sizes, stock);

    const product = new Product({
      name,
      slug,
      description: description || '',
      price: parseFloat(price),
      originalPrice: originalPrice ? parseFloat(originalPrice) : undefined,
      discount: discount ? parseFloat(discount) : undefined,
      costPrice: costPrice ? parseFloat(costPrice) : undefined,
      deliveryCost: deliveryCost !== undefined ? parseFloat(deliveryCost) : 60,
      pricingMode: pricingMode || 'auto',
      gstRate: gstRate !== undefined ? parseFloat(gstRate) : 5,
      stock: parseInt(stock) || 0,
      category: category || 'Uncategorized',
      subcategory: subcategory || '',
      dressStyle: dressStyle || '',
      images: normalizeProductImages(images),
      colors: colors || [],
      sizes: normalizedSizeInventory.map((entry) => entry.size),
      sizeInventory: normalizedSizeInventory,
      rating: rating || { rating: 4.5, reviews: 0 },
      isNewArrival: isNewArrival || false,
      isBestSeller: isBestSeller || false,
      isFeatured: isFeatured || false,
      productSource: productSource || 'Manufacturer',
      listedBy: req.user?._id || req.user?.id || null,
      details: details ? (typeof details === 'string' ? JSON.parse(details) : details) : {},
      keyFeatures: keyFeatures ? (typeof keyFeatures === 'string' ? JSON.parse(keyFeatures) : keyFeatures) : []
    });

    await product.save();
    await product.populate('listedBy', 'name email');

    res.status(201).json(formatProductResponse(product));
  } catch (err) {
    next(err);
  }
};


exports.updateProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { 
      name, 
      description, 
      price, 
      originalPrice,
      discount,
      costPrice,
      deliveryCost,
      pricingMode,
      gstRate,
      stock, 
      category,
      subcategory,
      dressStyle,
      images,
      colors,
      sizes,
      sizeInventory,
      rating,
      isNewArrival,
      isBestSeller,
      isFeatured,
      productSource,
      details,
      keyFeatures
    } = req.body;

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (price !== undefined) updateData.price = parseFloat(price);
    if (originalPrice !== undefined) updateData.originalPrice = parseFloat(originalPrice);
    if (discount !== undefined) updateData.discount = parseFloat(discount);
    if (costPrice !== undefined) updateData.costPrice = parseFloat(costPrice);
    if (deliveryCost !== undefined) updateData.deliveryCost = parseFloat(deliveryCost);
    if (pricingMode !== undefined) updateData.pricingMode = pricingMode;
    if (gstRate !== undefined) updateData.gstRate = parseFloat(gstRate);
    if (stock !== undefined) updateData.stock = parseInt(stock);
    if (category !== undefined) updateData.category = category;
    if (subcategory !== undefined) updateData.subcategory = subcategory;
    if (dressStyle !== undefined) updateData.dressStyle = dressStyle;
    if (images !== undefined) updateData.images = normalizeProductImages(images);
    if (colors !== undefined) updateData.colors = colors;
    if (sizes !== undefined || sizeInventory !== undefined || stock !== undefined) {
      const normalizedSizeInventory = normalizeSizeInventory(sizeInventory, sizes, stock);
      updateData.sizes = normalizedSizeInventory.map((entry) => entry.size);
      updateData.sizeInventory = normalizedSizeInventory;
    }
    if (rating !== undefined) updateData.rating = rating;
    if (isNewArrival !== undefined) updateData.isNewArrival = isNewArrival;
    if (isBestSeller !== undefined) updateData.isBestSeller = isBestSeller;
    if (isFeatured !== undefined) updateData.isFeatured = isFeatured;
    if (productSource !== undefined) updateData.productSource = productSource;
    if (details !== undefined) updateData.details = typeof details === 'string' ? JSON.parse(details) : details;
    if (keyFeatures !== undefined) updateData.keyFeatures = typeof keyFeatures === 'string' ? JSON.parse(keyFeatures) : keyFeatures;

    const product = await Product.findByIdAndUpdate(id, updateData, { returnDocument: 'after' });
    if (!product) return res.status(404).json({ error: 'Product not found' });

    res.json(formatProductResponse(product));
  } catch (err) {
    next(err);
  }
};


exports.deleteProduct = async (req, res, next) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json({ ok: true, message: 'Product deleted successfully' });
  } catch (err) {
    next(err);
  }
};

// ==================== ORDERS ====================

