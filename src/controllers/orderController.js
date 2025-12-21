const Order = require('../models/Order');
const Product = require('../models/Product');
const RazorpayUtil = require('../utils/razorpay');
const mailService = require('../services/mail.service');

exports.create = async (req, res, next) => {
  try {
    const { items, shippingAddress } = req.body;
    if (!items || !items.length) return res.status(400).json({ error: 'No items' });

    // build order items and calculate total
    let total = 0;
    const orderItems = [];
    for (const it of items) {
      const product = await Product.findById(it.product);
      if (!product) return res.status(400).json({ error: 'Invalid product ' + it.product });
      // Check available stock (stock - reserved)
      const availableStock = product.stock - (product.reserved || 0);
      if (availableStock < it.quantity) return res.status(400).json({ error: 'Out of stock for ' + product.name });
      const price = product.price;
      total += price * it.quantity;
      orderItems.push({ product: product._id, name: product.name, quantity: it.quantity, price });
    }

    // create a Razorpay order (amount in paise)
    const razorOrder = await RazorpayUtil.createOrder({ amount: Math.round(total * 100), currency: 'INR' });

    const order = await Order.create({
      customer: req.user.id,
      items: orderItems,
      total,
      status: 'pending',
      payment: { razorpayOrderId: razorOrder.id, status: 'pending' },
      shippingAddress
    });

    // RESERVE stock (mark as reserved but don't reduce available stock yet)
    for (const it of orderItems) {
      await Product.findByIdAndUpdate(it.product, { $inc: { reserved: it.quantity } });
    }

    res.status(201).json({ order, razorOrder });
  } catch (err) {
    next(err);
  }
};

/**
 * Verify Razorpay payment signature and finalize order
 * Called after successful payment
 */
exports.verifyPayment = async (req, res, next) => {
  try {
    const { orderId, razorpayPaymentId, razorpaySignature } = req.body;
    
    if (!orderId || !razorpayPaymentId || !razorpaySignature) {
      console.error('❌ Missing payment details:', { orderId, razorpayPaymentId, razorpaySignature });
      return res.status(400).json({ error: 'Missing payment details' });
    }

    const order = await Order.findById(orderId).populate('customer');
    if (!order) {
      console.error('❌ Order not found:', orderId);
      return res.status(404).json({ error: 'Order not found' });
    }

    // Verify user owns this order
    if (String(order.customer._id) !== String(req.user.id)) {
      console.error('❌ Unauthorized access to order:', orderId);
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Verify Razorpay signature
    console.log('🔍 Verifying payment signature...');
    
    // In test mode, allow bypass if RAZORPAY_TEST_MODE_SKIP_VERIFICATION is set
    const isTestMode = process.env.RAZORPAY_KEY_ID?.includes('rzp_test');
    const skipVerification = isTestMode && process.env.RAZORPAY_TEST_MODE_SKIP_VERIFICATION === 'true';
    
    let isValid = false;
    if (skipVerification) {
      console.warn('⚠️ SKIPPING signature verification (test mode enabled)');
      isValid = true;
    } else {
      isValid = RazorpayUtil.verifyPaymentSignature(
        order.payment.razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature
      );
    }

    if (!isValid) {
      console.error('❌ Invalid payment signature for order:', orderId);
      // Release reserved stock on failed verification
      for (const it of order.items) {
        await Product.findByIdAndUpdate(it.product, { $inc: { reserved: -it.quantity } });
      }
      return res.status(400).json({ error: 'Invalid payment signature' });
    }
    
    if (skipVerification) {
      console.log('✅ Payment verification SKIPPED (test mode)');
    } else {
      console.log('✅ Payment signature verified');
    }

    // Update order payment status
    order.payment.transactionId = razorpayPaymentId;
    order.payment.status = 'success';
    order.status = 'confirmed';
    await order.save();
    console.log('✅ Payment verified successfully for order:', orderId);

    // DECREMENT actual stock (payment successful)
    for (const it of order.items) {
      await Product.findByIdAndUpdate(it.product, { 
        $inc: { stock: -it.quantity, reserved: -it.quantity } 
      });
    }
    console.log('✅ Stock updated for order:', orderId);

    // Send confirmation email (non-blocking)
    if (mailService && mailService.sendOrderConfirmation) {
      mailService.sendOrderConfirmation({
        customerName: order.customer.name,
        customerEmail: order.customer.email,
        orderId: order._id.toString(),
        orderDate: order.createdAt,
        items: order.items.map(it => ({
          name: it.name,
          quantity: it.quantity,
          price: it.price
        })),
        totalAmount: order.total,
        shippingAddress: order.shippingAddress
      }).catch(err => console.error('Email send failed:', err));
    }

    res.json({ message: 'Payment verified successfully', order });
  } catch (err) {
    next(err);
  }
};

exports.get = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id).populate('customer').populate('items.product');
    if (!order) return res.status(404).json({ error: 'Not found' });
    if (String(order.customer._id) !== String(req.user.id) && !req.user.roles.includes('admin'))
      return res.status(403).json({ error: 'Forbidden' });
    res.json(order);
  } catch (err) {
    next(err);
  }
};

/**
 * List all orders (admin only)
 */
exports.list = async (req, res, next) => {
  try {
    // Allow admins to list all orders. For regular users, return only their orders.
    const isAdmin = req.user.roles && req.user.roles.includes('admin')
    const { status, sort = '-createdAt', limit = 20, page = 1 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    let query = {}
    if (status) query.status = status

    if (!isAdmin) {
      // restrict to current user's orders
      query.customer = req.user.id
    }

    // Populate customer for admins, and product references for items for richer client-side rendering
    const q = Order.find(query)
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))

    if (isAdmin) q.populate('customer', 'name email phone')
    // always populate products inside items where possible
    q.populate('items.product')

    const orders = await q.exec()

    const total = await Order.countDocuments(query)

    res.json({ orders, pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) } })
  } catch (err) {
    next(err);
  }
};

/**
 * Update order status (admin only)
 */
exports.updateStatus = async (req, res, next) => {
  try {
    if (!req.user.roles || !req.user.roles.includes('admin')) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { status, trackingNumber } = req.body;
    const validStatuses = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];

    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Valid statuses: ${validStatuses.join(', ')}` });
    }

    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { 
        status,
        ...(trackingNumber && { trackingNumber })
      },
      { new: true }
    ).populate('customer');

    if (!order) return res.status(404).json({ error: 'Order not found' });

    res.json({ message: 'Order status updated', order });
  } catch (err) {
    next(err);
  }
};

/**
 * Cancel order and release stock (admin or customer)
 */
exports.cancel = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id).populate('customer');
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // Check authorization
    const isOwner = String(order.customer._id) === String(req.user.id);
    const isAdmin = req.user.roles && req.user.roles.includes('admin');
    
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Only allow cancellation of pending/confirmed orders
    if (['shipped', 'delivered', 'cancelled'].includes(order.status)) {
      return res.status(400).json({ error: `Cannot cancel order with status: ${order.status}` });
    }

    // Release reserved stock
    for (const it of order.items) {
      if (order.status === 'pending') {
        // For pending: release reserved only
        await Product.findByIdAndUpdate(it.product, { $inc: { reserved: -it.quantity } });
      } else if (order.status === 'confirmed') {
        // For confirmed: restore stock and release reserved
        await Product.findByIdAndUpdate(it.product, {
          $inc: { stock: it.quantity, reserved: -it.quantity }
        });
      }
    }

    order.status = 'cancelled';
    await order.save();

    res.json({ message: 'Order cancelled successfully', order });
  } catch (err) {
    next(err);
  }
};

module.exports = exports;
