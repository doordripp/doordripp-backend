const mongoose = require('mongoose');
const logger = require('../utils/logger');
const User = require('../models/User');
const Product = require('../models/Product');
const Order = require('../models/Order');
const AreaManager = require('../models/AreaManager');
const { hasAnyRole } = require('../middleware/auth');

const CURRENT_DELIVERY_ORDER_STATUSES = ['pending', 'confirmed', 'packed', 'processing', 'shipped'];

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
  const assignments = await AreaManager.find({
    manager: userId,
    status: 'active'
  }).populate('deliveryZone');

  return assignments
    .map(assignment => assignment.deliveryZone)
    .filter(Boolean)
    .filter(zone => zone.isActive);
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

// ==================== DASHBOARD STATS ====================
exports.getDashboardStats = async (req, res, next) => {
  try {
    const [totalProducts, totalUsers, totalOrders, orders] = await Promise.all([
      Product.countDocuments(),
      User.countDocuments(),
      Order.countDocuments(),
      // Get all non-cancelled orders for total sales calculation
      Order.find({ status: { $ne: 'cancelled' } }, 'total status createdAt')
    ]);

    // Calculate total sales excluding cancelled orders
    const totalSales = orders.reduce((sum, order) => sum + (Number(order.total) || 0), 0);

    // Orders by status
    const ordersByStatus = orders.reduce((acc, order) => {
      acc[order.status] = (acc[order.status] || 0) + 1;
      return acc;
    }, {});

    // Recent orders (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recentOrdersCount = orders.filter(o => new Date(o.createdAt) >= thirtyDaysAgo).length;

    res.json({
      totalSales,
      totalOrders,
      totalProducts,
      totalCustomers: totalUsers,
      recentOrdersCount,
      salesGrowth: '+12.5%',
      ordersGrowth: '+8.2%',
      customersGrowth: '+5.1%',
      productsGrowth: '+3.4%',
      ordersByStatus
    });
  } catch (err) {
    next(err);
  }
};

// ==================== PRODUCTS ====================
exports.listProducts = async (req, res, next) => {
  try {
    const { search, category, page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const filter = {};
    if (search) {
      filter.$or = [
        { name: new RegExp(search, 'i') },
        { description: new RegExp(search, 'i') }
      ];
    }
    if (category && category !== 'All') {
      filter.category = category;
    }

    const [products, total] = await Promise.all([
      Product.find(filter).skip(skip).limit(parseInt(limit)).sort({ createdAt: -1 }),
      Product.countDocuments(filter)
    ]);

    const formattedProducts = products.map(p => ({
      id: p._id,
      _id: p._id,
      name: p.name,
      slug: p.slug,
      description: p.description,
      price: p.price,
      originalPrice: p.originalPrice,
      discount: p.discount,
      stock: p.stock,
      category: p.category,
      subcategory: p.subcategory,
      images: p.images || [],
      colors: p.colors || [],
      sizes: p.sizes || [],
      rating: p.rating || { rating: 4.5, reviews: 0 },
      isNewArrival: p.isNewArrival || false,
      isBestSeller: p.isBestSeller || false,
      isFeatured: p.isFeatured || false,
      status: p.stock > 0 ? 'Active' : 'Out of Stock'
    }));

    res.json({
      products: formattedProducts,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit))
    });
  } catch (err) {
    next(err);
  }
};

exports.getProduct = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    res.json({
      id: product._id,
      _id: product._id,
      name: product.name,
      slug: product.slug,
      description: product.description,
      price: product.price,
      originalPrice: product.originalPrice,
      discount: product.discount,
      stock: product.stock,
      category: product.category,
      subcategory: product.subcategory,
      images: product.images || [],
      colors: product.colors || [],
      sizes: product.sizes || [],
      rating: product.rating || { rating: 4.5, reviews: 0 },
      isNewArrival: product.isNewArrival || false,
      isBestSeller: product.isBestSeller || false,
      isFeatured: product.isFeatured || false
    });
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
      stock, 
      category, 
      subcategory,
      images,
      colors,
      sizes,
      rating,
      isNewArrival,
      isBestSeller,
      isFeatured,
      details,
      keyFeatures
    } = req.body;

    // Generate slug
    const slug = name.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') +
      '-' + Date.now().toString(36);

    const product = new Product({
      name,
      slug,
      description: description || '',
      price: parseFloat(price),
      originalPrice: originalPrice ? parseFloat(originalPrice) : undefined,
      discount: discount ? parseFloat(discount) : undefined,
      stock: parseInt(stock) || 0,
      category: category || 'Uncategorized',
      subcategory: subcategory || '',
      images: images || [],
      colors: colors || [],
      sizes: sizes || [],
      rating: rating || { rating: 4.5, reviews: 0 },
      isNewArrival: isNewArrival || false,
      isBestSeller: isBestSeller || false,
      isFeatured: isFeatured || false,
      details: details ? (typeof details === 'string' ? JSON.parse(details) : details) : {},
      keyFeatures: keyFeatures ? (typeof keyFeatures === 'string' ? JSON.parse(keyFeatures) : keyFeatures) : []
    });

    await product.save();

    res.status(201).json({
      id: product._id,
      _id: product._id,
      name: product.name,
      slug: product.slug,
      description: product.description,
      price: product.price,
      originalPrice: product.originalPrice,
      discount: product.discount,
      stock: product.stock,
      category: product.category,
      subcategory: product.subcategory,
      images: product.images,
      colors: product.colors,
      sizes: product.sizes,
      rating: product.rating,
      isNewArrival: product.isNewArrival,
      isBestSeller: product.isBestSeller,
      isFeatured: product.isFeatured,
      details: product.details,
      keyFeatures: product.keyFeatures,
      status: product.stock > 0 ? 'Active' : 'Out of Stock'
    });
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
      stock, 
      category,
      subcategory, 
      images,
      colors,
      sizes,
      rating,
      isNewArrival,
      isBestSeller,
      isFeatured,
      details,
      keyFeatures
    } = req.body;

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (price !== undefined) updateData.price = parseFloat(price);
    if (originalPrice !== undefined) updateData.originalPrice = parseFloat(originalPrice);
    if (discount !== undefined) updateData.discount = parseFloat(discount);
    if (stock !== undefined) updateData.stock = parseInt(stock);
    if (category !== undefined) updateData.category = category;
    if (subcategory !== undefined) updateData.subcategory = subcategory;
    if (images !== undefined) updateData.images = images;
    if (colors !== undefined) updateData.colors = colors;
    if (sizes !== undefined) updateData.sizes = sizes;
    if (rating !== undefined) updateData.rating = rating;
    if (isNewArrival !== undefined) updateData.isNewArrival = isNewArrival;
    if (isBestSeller !== undefined) updateData.isBestSeller = isBestSeller;
    if (isFeatured !== undefined) updateData.isFeatured = isFeatured;
    if (details !== undefined) updateData.details = typeof details === 'string' ? JSON.parse(details) : details;
    if (keyFeatures !== undefined) updateData.keyFeatures = typeof keyFeatures === 'string' ? JSON.parse(keyFeatures) : keyFeatures;

    const product = await Product.findByIdAndUpdate(id, updateData, { new: true });
    if (!product) return res.status(404).json({ error: 'Product not found' });

    res.json({
      id: product._id,
      _id: product._id,
      name: product.name,
      slug: product.slug,
      description: product.description,
      price: product.price,
      originalPrice: product.originalPrice,
      discount: product.discount,
      stock: product.stock,
      category: product.category,
      subcategory: product.subcategory,
      images: product.images,
      colors: product.colors,
      sizes: product.sizes,
      rating: product.rating,
      isNewArrival: product.isNewArrival,
      isBestSeller: product.isBestSeller,
      isFeatured: product.isFeatured,
      details: product.details,
      keyFeatures: product.keyFeatures,
      status: product.stock > 0 ? 'Active' : 'Out of Stock'
    });
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
exports.listOrders = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const isAdmin = hasAnyRole(req.user?.roles, ['admin']);
    const isDeliveryPartner = hasAnyRole(req.user?.roles, ['delivery_partner']);

    if (!isAdmin && !isDeliveryPartner) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    if (isDeliveryPartner) {
      const assignedZones = await getAssignedZonesForDeliveryUser(req.user.id);
      if (assignedZones.length === 0) {
        return res.json({
          orders: [],
          total: 0,
          page: parseInt(page),
          totalPages: 0
        });
      }

      const filter = {
        status: status && status !== 'all' ? status : { $in: CURRENT_DELIVERY_ORDER_STATUSES }
      };

      const candidateOrders = await Order.find(filter)
        .populate('customer', 'name email')
        .sort({ createdAt: -1 });

      const zoneFilteredOrders = candidateOrders.filter(order => {
        if (!isOrderInAnyAssignedZone(order, assignedZones)) return false;
        // Delivery partners can work on unassigned orders in their zone,
        // or orders already assigned to themselves.
        return !hasAnyAssignedPartner(order) || isAssignedToPartner(order, req.user.id);
      });
      const paginatedOrders = zoneFilteredOrders.slice(skip, skip + parseInt(limit));

      const formattedOrders = paginatedOrders.map(order => ({
        id: order._id,
        _id: order._id,
        customer: order.customer?.name || 'Unknown',
        customerEmail: order.customer?.email || '',
        items: order.items,
        total: order.total,
        totalBeforeDiscount: order.totalBeforeDiscount || order.total,
        voucherDiscount: order.voucherDiscount || 0,
        voucher: order.voucher || null,
        status: order.status,
        assignedDeliveryPartner: order.assignedDeliveryPartner,
        deliveryStatus: order.deliveryStatus,
        statusHistory: order.statusHistory || [],
        isTrial: order.isTrial || false,
        trialItems: order.trialItems || [],
        trialFee: order.trialFee || 0,
        deliveryFee: order.deliveryFee || 0,
        shippingAddress: order.shippingAddress,
        payment: order.payment,
        date: order.createdAt
      }));

      return res.json({
        orders: formattedOrders,
        total: zoneFilteredOrders.length,
        page: parseInt(page),
        totalPages: Math.ceil(zoneFilteredOrders.length / parseInt(limit))
      });
    }

    const filter = {};
    if (status && status !== 'all') {
      filter.status = status;
    }

    const [orders, total] = await Promise.all([
      Order.find(filter)
        .populate('customer', 'name email')
        .skip(skip)
        .limit(parseInt(limit))
        .sort({ createdAt: -1 }),
      Order.countDocuments(filter)
    ]);

    logger.info(`📦 Admin fetching orders: ${orders.length} found, ${total} total in DB`);

    const formattedOrders = orders.map(order => ({
      id: order._id,
      _id: order._id,
      customer: order.customer?.name || 'Unknown',
      customerEmail: order.customer?.email || '',
      items: order.items,
      total: order.total,
      totalBeforeDiscount: order.totalBeforeDiscount || order.total,
      voucherDiscount: order.voucherDiscount || 0,
      voucher: order.voucher || null,
      status: order.status,
      deliveryStatus: order.deliveryStatus,
      statusHistory: order.statusHistory || [],
      isTrial: order.isTrial || false,
      trialItems: order.trialItems || [],
      trialFee: order.trialFee || 0,
      deliveryFee: order.deliveryFee || 0,
      shippingAddress: order.shippingAddress,
      payment: order.payment,
      date: order.createdAt
    }));

    res.json({
      orders: formattedOrders,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit))
    });
  } catch (err) {
    logger.error('❌ Error fetching orders:', err);
    next(err);
  }
};

exports.getOrder = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id).populate('customer', 'name email');
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const isAdmin = hasAnyRole(req.user?.roles, ['admin']);
    const isDeliveryPartner = hasAnyRole(req.user?.roles, ['delivery_partner']);

    if (!isAdmin && isDeliveryPartner) {
      if (!CURRENT_DELIVERY_ORDER_STATUSES.includes(order.status)) {
        return res.status(403).json({ error: 'You can only access current orders' });
      }

      const assignedZones = await getAssignedZonesForDeliveryUser(req.user.id);
      const canAccessOrder = isOrderInAnyAssignedZone(order, assignedZones);

      if (!canAccessOrder) {
        return res.status(403).json({ error: 'Order is outside your assigned area' });
      }

      // If already assigned, only the assigned partner may manage/view it.
      if (hasAnyAssignedPartner(order) && !isAssignedToPartner(order, req.user.id)) {
        return res.status(403).json({ error: 'Order is assigned to another delivery partner' });
      }
    }

    res.json({
      id: order._id,
      _id: order._id,
      customer: order.customer?.name || 'Unknown',
      customerEmail: order.customer?.email || '',
      items: order.items,
      total: order.total,
      totalBeforeDiscount: order.totalBeforeDiscount || order.total,
      voucherDiscount: order.voucherDiscount || 0,
      voucher: order.voucher || null,
      status: order.status,
      assignedDeliveryPartner: order.assignedDeliveryPartner,
      deliveryStatus: order.deliveryStatus,
      statusHistory: order.statusHistory || [],
      isTrial: order.isTrial || false,
      trialItems: order.trialItems || [],
      trialFee: order.trialFee || 0,
      deliveryFee: order.deliveryFee || 0,
      shippingAddress: order.shippingAddress,
      payment: order.payment,
      date: order.createdAt
    });
  } catch (err) {
    next(err);
  }
};

exports.updateOrderStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, note } = req.body;
    const isAdmin = hasAnyRole(req.user?.roles, ['admin']);
    const isDeliveryPartner = hasAnyRole(req.user?.roles, ['delivery_partner']);

    if (!isAdmin && !isDeliveryPartner) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const validStatuses = isAdmin
      ? ['pending', 'confirmed', 'packed', 'processing', 'shipped', 'delivered', 'cancelled']
      : ['packed', 'processing', 'shipped', 'delivered'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const existingOrder = await Order.findById(id);
    if (!existingOrder) return res.status(404).json({ error: 'Order not found' });

    if (isDeliveryPartner) {
      const assignedZones = await getAssignedZonesForDeliveryUser(req.user.id);
      const canAccessOrder = isOrderInAnyAssignedZone(existingOrder, assignedZones);

      if (!canAccessOrder) {
        return res.status(403).json({ error: 'Order is outside your assigned area' });
      }

      if (!CURRENT_DELIVERY_ORDER_STATUSES.includes(existingOrder.status) && existingOrder.status !== 'delivered') {
        return res.status(400).json({ error: `Cannot update order with status: ${existingOrder.status}` });
      }
    }

    existingOrder.status = status;
    existingOrder.deliveryUpdates = existingOrder.deliveryUpdates || [];
    existingOrder.deliveryUpdates.push({
      status,
      note: typeof note === 'string' ? note.trim() : undefined,
      updatedBy: req.user.id,
      updatedByRole: isAdmin ? 'admin' : 'delivery_partner',
      updatedAt: new Date()
    });
    await existingOrder.save();

    const order = await Order.findById(id).populate('customer');

    // Generate invoice when order is delivered (for COD orders)
    if (status === 'delivered' && order.payment?.method === 'cod') {
      const InvoiceService = require('../services/invoiceService');
      InvoiceService.generateInvoice(order._id.toString())
        .then(invoiceResult => {
          logger.info(`✅ Invoice generated for delivered COD order: ${invoiceResult.invoice.invoiceNumber}`);
          // Send invoice email if mail service available
          const mailService = require('../services/mail.service');
          if (mailService && mailService.sendInvoiceEmail) {
            mailService.sendInvoiceEmail({
              customerName: order.customer?.name || 'Customer',
              customerEmail: order.customer?.email,
              invoiceNumber: invoiceResult.invoice.invoiceNumber,
              pdfPath: invoiceResult.pdfPath
            }).catch(err => logger.error('Invoice email send failed:', err));
          }
        })
        .catch(err => {
          // Don't fail the status update if invoice generation fails
          if (!err.message.includes('already exists')) {
            logger.error('Invoice generation failed:', err);
          }
        });
    }

    res.json({ ok: true, order });
  } catch (err) {
    next(err);
  }
};

// ACCEPT DELIVERY - Assign delivery partner to order
exports.acceptDelivery = async (req, res, next) => {
  try {
    const { id } = req.params;
    const isDeliveryPartner = hasAnyRole(req.user?.roles, ['delivery_partner']);
    
    if (!isDeliveryPartner) {
      return res.status(403).json({ error: 'Only delivery partners can accept deliveries' });
    }

    const order = await Order.findById(id).populate('customer', 'name email phone');
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Check if order is in accepted zone
    const assignedZones = await getAssignedZonesForDeliveryUser(req.user.id);
    const canAccessOrder = isOrderInAnyAssignedZone(order, assignedZones);
    
    if (!canAccessOrder) {
      return res.status(403).json({ error: 'Order is outside your assigned area' });
    }

    // Check if order already has a delivery partner
    if (hasAnyAssignedPartner(order)) {
      return res.status(400).json({ error: 'Order already assigned to a delivery partner' });
    }

    // Check if order is in acceptable status
    if (!['pending', 'confirmed', 'packed'].includes(order.status)) {
      return res.status(400).json({ error: `Cannot accept order with status: ${order.status}` });
    }

    // Get delivery partner details
    const partner = await User.findById(req.user.id);
    
    // Assign delivery partner to order
    order.assignedDeliveryPartner = partner._id;
    order.assignedAt = new Date();
    order.assignedBy = req.user.id;

    order.deliveryPartner = {
      id: partner._id,
      name: partner.name,
      phone: partner.phone || partner.phoneNumber,
      photo: partner.profilePhoto || partner.photo,
      rating: partner.rating || 4.8,
      vehicleType: partner.vehicleType || 'bike'
    };

    // Update order status to processing and initialize delivery timeline status
    order.status = 'processing';
    order.deliveryStatus = 'Accepted';
    order.orderStatus = 'PREPARING';

    if (!order.statusHistory) order.statusHistory = [];
    order.statusHistory.push({
      status: 'Accepted',
      timestamp: new Date(),
      updatedBy: req.user.id,
      updatedByRole: 'delivery_partner'
    });

    // Set customer location from shipping address if available
    if (order.shippingAddress?.latitude && order.shippingAddress?.longitude) {
      order.customerLocation = {
        lat: order.shippingAddress.latitude,
        lng: order.shippingAddress.longitude
      };
    }

    // Add to timeline
    if (!order.timeline) order.timeline = [];
    order.timeline.push({
      status: 'PREPARING',
      timestamp: new Date()
    });

    // Add to delivery updates
    if (!order.deliveryUpdates) order.deliveryUpdates = [];
    order.deliveryUpdates.push({
      status: 'processing',
      note: 'Delivery partner accepted the order',
      updatedBy: req.user.id,
      updatedByRole: 'delivery_partner',
      updatedAt: new Date()
    });

    await order.save();

    // Send notification to customer (if notification service exists)
    try {
      const mailService = require('../services/mail.service');
      if (mailService && mailService.sendOrderUpdateEmail) {
        mailService.sendOrderUpdateEmail({
          customerName: order.customer?.name || 'Customer',
          customerEmail: order.customer?.email,
          orderId: order._id,
          status: 'processing',
          deliveryPartner: order.deliveryPartner,
          trackingUrl: `${process.env.FRONTEND_URL}/order/${order._id}/track`
        }).catch(err => logger.error('Order update email failed:', err));
      }
    } catch (err) {
      logger.info('Mail service not available:', err.message);
    }

    res.json({ 
      ok: true, 
      order,
      trackingUrl: `/order/${order._id}/track`
    });
  } catch (err) {
    logger.error('❌ Error accepting delivery:', err);
    next(err);
  }
};

// ==================== USERS ====================
exports.listUsers = async (req, res, next) => {
  try {
    const { search, page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const filter = {};
    if (search) {
      filter.$or = [
        { name: new RegExp(search, 'i') },
        { email: new RegExp(search, 'i') }
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
    const { id } = req.params;
    const { name, email, roles, blocked } = req.body;

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (email !== undefined) updateData.email = email;
    if (roles !== undefined) updateData.roles = roles;
    if (blocked !== undefined) updateData.blocked = blocked;

    const user = await User.findByIdAndUpdate(id, updateData, { new: true }).select('-password -refreshToken');
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
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true, message: 'User deleted successfully' });
  } catch (err) {
    next(err);
  }
};

// ==================== REPORTS ====================
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

// ==================== USER MANAGEMENT ====================

/**
 * Get all users with filtering and search
 */
exports.getAllUsers = async (req, res, next) => {
  try {
    const { search, role, status, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build query
    let query = {};

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } }
      ];
    }

    if (role && role !== 'all') {
      query.roles = role;
    }

    if (status === 'banned') {
      query.isBanned = true;
    } else if (status === 'active') {
      query.isBanned = false;
    }

    const [users, total] = await Promise.all([
      User.find(query)
        .select('-password -resetPasswordToken')
        .skip(skip)
        .limit(parseInt(limit))
        .sort({ createdAt: -1 }),
      User.countDocuments(query)
    ]);

    res.json({
      success: true,
      users,
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
    const { roles } = req.body;

    if (!roles || !Array.isArray(roles) || roles.length === 0) {
      return res.status(400).json({ success: false, error: 'Roles must be a non-empty array' });
    }

    // Validate roles
    const validRoles = ['admin', 'manager', 'delivery_partner', 'customer'];
    const isValid = roles.every(role => validRoles.includes(role));
    if (!isValid) {
      return res.status(400).json({ success: false, error: 'Invalid role specified' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    user.roles = roles;
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
exports.assignDeliveryPartner = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { deliveryPartnerId } = req.body;

    if (!deliveryPartnerId) {
      return res.status(400).json({
        ok: false,
        error: 'Delivery partner ID is required'
      });
    }

    // Verify order exists
    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ ok: false, error: 'Order not found' });
    }

    // Verify user exists and has delivery_partner role
    const deliveryPartner = await User.findById(deliveryPartnerId);
    if (!deliveryPartner) {
      return res.status(404).json({ ok: false, error: 'Delivery partner not found' });
    }

    if (!deliveryPartner.roles || !deliveryPartner.roles.includes('delivery_partner')) {
      return res.status(400).json({
        ok: false,
        error: 'User must have delivery_partner role'
      });
    }

    // Assign the delivery partner
    order.assignedDeliveryPartner = deliveryPartnerId;
    order.assignedAt = new Date();
    order.assignedBy = req.user.id;

    // Update deliveryPartner info for tracking
    order.deliveryPartner = {
      riderId: deliveryPartner._id,
      name: deliveryPartner.name || deliveryPartner.email,
      phone: deliveryPartner.phone || deliveryPartner.phoneNumber || '',
      photo: deliveryPartner.profileImage || deliveryPartner.profilePhoto || '',
      rating: deliveryPartner.rating || 4.8,
      vehicleType: deliveryPartner.vehicleType || 'bike'
    };

    // Add to delivery updates
    order.deliveryUpdates.push({
      status: order.status,
      note: `Assigned to ${deliveryPartner.name || deliveryPartner.email}`,
      updatedBy: req.user.id,
      updatedByRole: 'admin',
      updatedAt: new Date()
    });

    await order.save();

    // Emit socket event for real-time updates
    if (req.app.get('io')) {
      req.app.get('io').emit('order-assigned', {
        orderId: order._id,
        deliveryPartner: order.deliveryPartner,
        timestamp: new Date()
      });
    }

    res.json({
      ok: true,
      message: 'Delivery partner assigned successfully',
      order
    });
  } catch (error) {
    logger.error('Error assigning delivery partner:', error);
    next(error);
  }
};

/**
 * Unassign delivery partner from an order
 * POST /api/admin/orders/:id/unassign
 */
exports.unassignDeliveryPartner = async (req, res, next) => {
  try {
    const { id } = req.params;

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ ok: false, error: 'Order not found' });
    }

    if (!order.assignedDeliveryPartner) {
      return res.status(400).json({
        ok: false,
        error: 'Order has no assigned delivery partner'
      });
    }

    // Remove assignment
    const previousPartner = order.assignedDeliveryPartner;
    order.assignedDeliveryPartner = undefined;
    order.assignedAt = undefined;
    order.assignedBy = undefined;

    // Add to delivery updates
    order.deliveryUpdates.push({
      status: order.status,
      note: 'Delivery partner assignment removed',
      updatedBy: req.user.id,
      updatedByRole: 'admin',
      updatedAt: new Date()
    });

    await order.save();

    // Emit socket event
    if (req.app.get('io')) {
      req.app.get('io').emit('order-unassigned', {
        orderId: order._id,
        previousPartner,
        timestamp: new Date()
      });
    }

    res.json({
      ok: true,
      message: 'Delivery partner unassigned successfully',
      order
    });
  } catch (error) {
    logger.error('Error unassigning delivery partner:', error);
    next(error);
  }
};

