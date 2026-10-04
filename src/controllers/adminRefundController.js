/**
 * Manual refund tracking (admin only).
 *
 * Refunds are issued by staff in the Razorpay dashboard. Nothing here talks to
 * Razorpay: these endpoints list the orders that are owed a refund and let an
 * admin record that the refund has been made.
 */

const mongoose = require('mongoose');
const Order = require('../models/Order');
const orderLifecycle = require('../services/orderLifecycle.service');
const logger = require('../utils/logger');

const toRefundRow = (order) => ({
  orderId: order._id,
  orderStatus: order.status,
  customer: order.customer && order.customer._id
    ? { _id: order.customer._id, name: order.customer.name, email: order.customer.email, phone: order.customer.phone }
    : null,
  // The full amount the customer paid for this order, delivery fee included.
  amount: order.total,
  currency: 'INR',
  paymentMethod: order.payment?.method,
  razorpayPaymentId: order.payment?.transactionId || null,
  razorpayOrderId: order.payment?.razorpayOrderId || null,
  refundStatus: order.payment?.refundRequired ? 'required' : (order.payment?.refundStatus || 'none'),
  reason: order.payment?.refundReason || null,
  requestedAt: order.payment?.refundRequestedAt || null,
  refundedAt: order.payment?.refundedAt || null,
  refundedBy: order.payment?.refundedBy || null,
  refundReference: order.payment?.refundReference || null,
  refundNote: order.payment?.refundNote || null,
  orderCreatedAt: order.createdAt
});

/**
 * GET /api/admin/refunds?status=required|completed&page=&limit=
 * Default: refunds still owed, oldest first.
 */
exports.listRefunds = async (req, res, next) => {
  try {
    const status = req.query.status === 'completed' ? 'completed' : 'required';
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);

    const filter = status === 'completed'
      ? { 'payment.refundStatus': 'completed' }
      : { 'payment.refundRequired': true };
    const sort = status === 'completed'
      ? { 'payment.refundedAt': -1 }
      : { 'payment.refundRequestedAt': 1, createdAt: 1 };

    const [orders, total] = await Promise.all([
      Order.find(filter).sort(sort).skip((page - 1) * limit).limit(limit).populate('customer', 'name email phone'),
      Order.countDocuments(filter)
    ]);

    res.json({
      success: true,
      status,
      refunds: orders.map(toRefundRow),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/admin/orders/:id/refund/complete   { reference, note? }
 * Records that the refund was issued manually. `reference` is the Razorpay
 * refund id (or bank reference) so the refund can be traced later.
 */
exports.completeRefund = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(String(id))) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    const reference = typeof req.body?.reference === 'string' ? req.body.reference.trim() : '';
    const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 500) : '';
    if (!reference || reference.length > 100) {
      return res.status(400).json({ success: false, error: 'A refund reference (e.g. the Razorpay refund id) is required' });
    }

    const order = await orderLifecycle.completeManualRefund({
      orderId: id,
      adminId: req.user.id,
      reference,
      note
    });

    if (!order) {
      const exists = await Order.exists({ _id: id });
      if (!exists) return res.status(404).json({ success: false, error: 'Order not found' });
      return res.status(409).json({ success: false, error: 'This order is not awaiting a refund' });
    }

    logger.info(`Manual refund recorded for order ${order._id} by admin ${req.user.id}`);
    await order.populate('customer', 'name email phone');
    res.json({ success: true, message: 'Refund recorded', refund: toRefundRow(order) });
  } catch (err) {
    next(err);
  }
};
