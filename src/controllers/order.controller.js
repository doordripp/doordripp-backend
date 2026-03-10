const Order = require('../models/Order');
const logger = require('../utils/logger');
const User = require('../models/User');
const mailService = require('../services/mail.service');

/**
 * Order Controller with Email Notifications
 * 
 * Handles order confirmation and shipping status updates
 * Sends transactional emails for key order events
 * 
 * Security Notes:
 * - No payment details included in emails (PCI compliance)
 * - Only send emails to verified order owner
 * - Sanitize order data before sending to email service
 * 
 * @module OrderController
 */

/**
 * Create Order and Send Confirmation Email
 * Typically called after successful payment
 * 
 * @route POST /api/orders
 * @auth Required (user must be authenticated)
 */
exports.createOrder = async (req, res, next) => {
  try {
    const userId = req.user.id; // From auth middleware
    const { items, shippingAddress, totalAmount, paymentMethod } = req.body;

    // Comprehensive input validation
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Order items are required' });
    }

    // Validate item count (prevent abuse)
    if (items.length > 100) {
      return res.status(400).json({ error: 'Maximum 100 items per order' });
    }

    // Validate each item has required fields
    for (const item of items) {
      if (!item.productName || !item.quantity || !item.price) {
        return res.status(400).json({ error: 'Invalid item data' });
      }
      // Validate quantity and price are positive numbers
      if (item.quantity <= 0 || item.price < 0) {
        return res.status(400).json({ error: 'Invalid quantity or price' });
      }
    }

    if (!shippingAddress || typeof shippingAddress !== 'object') {
      return res.status(400).json({ error: 'Shipping address is required' });
    }

    // Validate required address fields
    const requiredFields = ['street', 'city', 'state', 'zip'];
    for (const field of requiredFields) {
      if (!shippingAddress[field]) {
        return res.status(400).json({ error: `Missing address field: ${field}` });
      }
    }

    // Validate totalAmount
    if (!totalAmount || typeof totalAmount !== 'number' || totalAmount <= 0) {
      return res.status(400).json({ error: 'Invalid total amount' });
    }

    // Get user details
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Create order
    const order = new Order({
      user: userId,
      items,
      shippingAddress,
      totalAmount,
      paymentMethod,
      status: 'confirmed',
      orderDate: new Date()
    });

    await order.save();

    // Calculate estimated delivery (5-7 business days)
    const estimatedDelivery = new Date();
    estimatedDelivery.setDate(estimatedDelivery.getDate() + 7);

    // Send order confirmation email (async - don't block response)
    // If email fails, log error but don't fail the order creation
    mailService.sendOrderConfirmation({
      customerName: user.name,
      customerEmail: user.email,
      orderId: order._id.toString(),
      orderDate: order.orderDate,
      items: items.map(item => ({
        name: item.productName || item.name,
        variant: item.variant || (item.size ? `Size: ${item.size}, Color: ${item.color}` : null),
        quantity: item.quantity,
        price: item.price
      })),
      totalAmount,
      shippingAddress,
      estimatedDelivery: estimatedDelivery.toLocaleDateString('en-IN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    }).catch(err => {
      logger.error('Failed to send order confirmation email:', err);
      // Log to error tracking service (Sentry, etc.)
    });

    logger.info(`✅ Order created: ${order._id} for user: ${user.email}`);

    res.status(201).json({
      message: 'Order created successfully',
      order: {
        id: order._id,
        status: order.status,
        totalAmount: order.totalAmount,
        orderDate: order.orderDate,
        estimatedDelivery
      }
    });

  } catch (error) {
    logger.error('Create order error:', error);
    res.status(500).json({ error: 'Failed to create order' });
  }
};

/**
 * Update Order Status and Send Shipping Email
 * Called when order status changes (shipped, delivered, etc.)
 * 
 * @route PATCH /api/orders/:orderId/status
 * @auth Required (admin only)
 */
exports.updateOrderStatus = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { status, trackingNumber, carrier } = req.body;

    // Validate status
    const validStatuses = ['processing', 'shipped', 'in-transit', 'out-for-delivery', 'delivered', 'cancelled'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ 
        error: 'Invalid order status',
        validStatuses 
      });
    }

    // Find order
    const order = await Order.findById(orderId).populate('user', 'name email');
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Update order
    order.status = status;
    if (trackingNumber) order.trackingNumber = trackingNumber;
    if (carrier) order.carrier = carrier;
    order.statusUpdatedAt = new Date();

    await order.save();

    // Send shipping update email for relevant statuses
    const emailStatuses = ['shipped', 'in-transit', 'out-for-delivery', 'delivered'];
    if (emailStatuses.includes(status)) {
      // Calculate estimated delivery
      let estimatedDelivery = 'Soon';
      if (status === 'shipped' || status === 'in-transit') {
        const deliveryDate = new Date();
        deliveryDate.setDate(deliveryDate.getDate() + 3);
        estimatedDelivery = deliveryDate.toLocaleDateString('en-IN', {
          month: 'short',
          day: 'numeric'
        });
      } else if (status === 'out-for-delivery') {
        estimatedDelivery = 'Today';
      } else if (status === 'delivered') {
        estimatedDelivery = 'Delivered';
      }

      // Send email (async - don't block response)
      mailService.sendShippingUpdate({
        customerName: order.user.name,
        customerEmail: order.user.email,
        orderId: order._id.toString(),
        status,
        trackingNumber: order.trackingNumber || 'N/A',
        carrier: order.carrier || 'Standard Delivery',
        estimatedDelivery,
        trackingUrl: `${process.env.CLIENT_URL}/orders/${order._id}`
      }).catch(err => {
        logger.error('Failed to send shipping update email:', err);
      });
    }

    logger.info(`✅ Order ${orderId} status updated to: ${status}`);

    res.json({
      message: 'Order status updated successfully',
      order: {
        id: order._id,
        status: order.status,
        trackingNumber: order.trackingNumber,
        carrier: order.carrier,
        statusUpdatedAt: order.statusUpdatedAt
      }
    });

  } catch (error) {
    logger.error('Update order status error:', error);
    res.status(500).json({ error: 'Failed to update order status' });
  }
};

/**
 * Get Order Details
 * 
 * @route GET /api/orders/:orderId
 * @auth Required (user must own the order)
 */
exports.getOrder = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const userId = req.user.id;

    const order = await Order.findById(orderId).populate('user', 'name email');
    
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Check if user owns this order (or is admin)
    const isOwner = order.user._id.toString() === userId;
    const isAdmin = req.user.roles && req.user.roles.includes('ADMIN');

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json({ order });

  } catch (error) {
    logger.error('Get order error:', error);
    res.status(500).json({ error: 'Failed to fetch order' });
  }
};

/**
 * Get User Orders
 * 
 * @route GET /api/orders
 * @auth Required
 */
exports.getUserOrders = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 10, status } = req.query;

    const query = { user: userId };
    if (status) query.status = status;

    const orders = await Order.find(query)
      .sort({ orderDate: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .select('-__v');

    const count = await Order.countDocuments(query);

    res.json({
      orders,
      totalPages: Math.ceil(count / limit),
      currentPage: page,
      totalOrders: count
    });

  } catch (error) {
    logger.error('Get user orders error:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
};

module.exports = exports;
