const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const Product = require('../models/Product');
const crypto = require('crypto');

/**
 * Razorpay Webhook Handler
 * Listens for payment events and updates order status
 */
router.post('/razorpay', async (req, res) => {
  try {
    const razorpaySignature = req.headers['x-razorpay-signature'];
    
    if (!razorpaySignature) {
      return res.status(400).json({ error: 'Missing signature' });
    }

    const body = req.rawBody || JSON.stringify(req.body);
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    // Verify webhook signature
    const hash = crypto
      .createHmac('sha256', webhookSecret)
      .update(body)
      .digest('hex');

    if (hash !== razorpaySignature) {
      return res.status(403).json({ error: 'Invalid signature' });
    }

    const event = req.body.event;
    const eventData = req.body.payload;

    if (event === 'payment.authorized' || event === 'payment.captured') {
      // Payment successful
      const payment = eventData.payment.entity;
      const razorpayOrderId = payment.order_id;

      // Find and update order
      const order = await Order.findOne({ 'payment.razorpayOrderId': razorpayOrderId });
      if (order) {
        order.payment.transactionId = payment.id;
        order.payment.status = 'success';
        order.status = 'confirmed';
        await order.save();

        // Decrement stock
        for (const item of order.items) {
          await Product.findByIdAndUpdate(item.product, {
            $inc: { stock: -item.quantity, reserved: -item.quantity }
          });
        }

        console.log(`✅ Webhook: Payment captured for order ${order._id}`);
      }
    } else if (event === 'payment.failed') {
      // Payment failed - release reserved stock
      const payment = eventData.payment.entity;
      const razorpayOrderId = payment.order_id;

      const order = await Order.findOne({ 'payment.razorpayOrderId': razorpayOrderId });
      if (order) {
        // Release reserved stock
        for (const item of order.items) {
          await Product.findByIdAndUpdate(item.product, {
            $inc: { reserved: -item.quantity }
          });
        }
        
        order.status = 'cancelled';
        order.payment.status = 'failed';
        await order.save();

        console.log(`❌ Webhook: Payment failed for order ${order._id}`);
      }
    }

    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

module.exports = router;
