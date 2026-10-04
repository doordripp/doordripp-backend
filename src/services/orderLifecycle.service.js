/**
 * Order state transitions that move money-adjacent state: stock, voucher usage
 * and payment status.
 *
 * Every transition here is
 *   - atomic:      one MongoDB transaction covers the order, stock and voucher
 *   - guarded:     the order row is "claimed" with a conditional update, so of
 *                  two concurrent callers exactly one performs the transition
 *   - idempotent:  repeating a transition that already happened is a no-op
 *
 * verify-payment (called by the app) and the Razorpay webhook both funnel into
 * confirmPaidOrder(), which is why they can not double-process an order.
 */

const mongoose = require('mongoose');
const Order = require('../models/Order');
const logger = require('../utils/logger');
const voucherService = require('./voucher.service');
const { reserveStock, releaseStock, StockError } = require('./inventory.service');

const PAYMENT_HOLD_MINUTES = () => {
  const parsed = parseInt(process.env.ORDER_PAYMENT_TIMEOUT_MINUTES || '30', 10);
  return Number.isFinite(parsed) && parsed >= 5 ? parsed : 30;
};

async function runInTransaction(work) {
  const session = await mongoose.startSession();
  try {
    let result;
    // withTransaction retries the callback on transient write conflicts, which is
    // what serialises two requests competing for the same order / product / voucher.
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

/** Fields that put an order on the manual-refund list. */
const refundRequiredFields = (reason) => ({
  'payment.refundRequired': true,
  'payment.refundStatus': 'required',
  'payment.refundReason': reason,
  'payment.refundRequestedAt': new Date()
});

const customerIdOf = (order) => (order.customer && order.customer._id ? order.customer._id : order.customer);

/** What an order created before atomic reservation would have deducted at confirmation. */
function legacyReservationFor(order) {
  const source = order.isTrial && Array.isArray(order.trialItems) && order.trialItems.length > 0
    ? order.trialItems
    : order.items;
  return (source || []).map(item => ({
    product: item.product,
    size: item.size,
    quantity: item.quantity || 1,
    name: item.name
  }));
}

/**
 * Create an order, reserve its stock and claim its voucher - all or nothing.
 * Throws StockError / VoucherError, in which case nothing was written.
 */
async function createOrderWithReservation({ orderData, reservationLines, userId }) {
  const voucherId = orderData.voucher && orderData.voucher.voucherId;
  if (voucherId) await voucherService.ensureUsageRow(voucherId, userId);

  return runInTransaction(async (session) => {
    const stockReservation = await reserveStock(reservationLines, session);

    const doc = { ...orderData, stockState: 'reserved', stockReservation };
    if (voucherId) {
      await voucherService.claimVoucher({ voucherId, userId, session });
      doc.voucher = { ...orderData.voucher, usageApplied: true };
    }

    const [order] = await Order.create([doc], { session });
    return order;
  });
}

/**
 * Record a successful online payment. Safe to call any number of times and from
 * several places at once.
 *
 * @returns {{ order, transitioned: boolean, refundRequired?: boolean }}
 *   transitioned is true for exactly one caller: the one that moved the order
 *   to confirmed. Only that caller should send emails / pushes / invoices.
 */
async function confirmPaidOrder({ orderId, razorpayOrderId, paymentId }) {
  const filter = orderId ? { _id: orderId } : { 'payment.razorpayOrderId': razorpayOrderId };
  if (!orderId && !razorpayOrderId) return { order: null, transitioned: false };

  try {
    return await runInTransaction(async (session) => {
      const current = await Order.findOne(filter).session(session);
      if (!current) return { order: null, transitioned: false };

      if (current.payment?.method === 'cod') return { order: current, transitioned: false };
      if (current.payment?.status === 'success') return { order: current, transitioned: false };

      // Claim the order. The filter is the guard: once one caller has flipped
      // payment.status to success nobody else can match.
      const order = await Order.findOneAndUpdate(
        { _id: current._id, 'payment.status': { $ne: 'success' }, status: { $in: ['pending', 'failed'] } },
        {
          $set: {
            'payment.status': 'success',
            'payment.transactionId': paymentId,
            'payment.refundRequired': false,
            'payment.refundStatus': 'none',
            status: 'confirmed'
          },
          $push: { statusHistory: { status: 'confirmed', timestamp: new Date(), updatedByRole: 'system' } }
        },
        { returnDocument: 'after', session }
      );

      if (!order) {
        // Not pending/failed any more (e.g. the customer cancelled before paying).
        if (current.status === 'cancelled' && paymentId) {
          await Order.updateOne(
            { _id: current._id },
            { $set: { 'payment.status': 'success', 'payment.transactionId': paymentId, ...refundRequiredFields('paid_after_cancellation') } },
            { session }
          );
          const updated = await Order.findById(current._id).session(session);
          return { order: updated, transitioned: false, refundRequired: true };
        }
        return { order: current, transitioned: false };
      }

      // Stock: normally already held since checkout. It has to be taken now only
      // for orders that predate reservation, or whose hold was released after a
      // failed attempt / timeout and the customer then paid anyway.
      if (order.stockState !== 'reserved') {
        const lines = order.stockReservation && order.stockReservation.length > 0
          ? order.stockReservation.map(l => ({ product: l.product, size: l.size, quantity: l.quantity }))
          : legacyReservationFor(order);
        order.stockReservation = await reserveStock(lines, session);
        order.stockState = 'reserved';
      }

      // Voucher: already claimed at checkout for current orders.
      if (order.voucher?.voucherId && !order.voucher.usageApplied) {
        try {
          await voucherService.claimVoucher({
            voucherId: order.voucher.voucherId,
            userId: customerIdOf(order),
            session
          });
        } catch (err) {
          if (err?.name !== 'VoucherError') throw err;
          // The customer has already paid the discounted amount; the order stands.
          logger.warn(`Voucher could not be claimed for paid order ${order._id}: ${err.message}`);
        }
        order.voucher.usageApplied = true;
      }

      await order.save({ session });
      return { order, transitioned: true };
    });
  } catch (err) {
    if (!(err instanceof StockError)) throw err;

    // Paid, but the units are gone. The money is real, so record the payment and
    // flag it for a refund instead of pretending the order can ship.
    const order = await Order.findOneAndUpdate(
      { ...filter, 'payment.status': { $ne: 'success' } },
      {
        $set: {
          'payment.status': 'success',
          'payment.transactionId': paymentId,
          ...refundRequiredFields('paid_but_out_of_stock'),
          'payment.failureReason': 'paid_after_stock_released',
          status: 'failed'
        }
      },
      { returnDocument: 'after' }
    );
    logger.security('Payment captured for an order that can no longer be fulfilled; refund required', {
      order: String(order?._id || orderId || razorpayOrderId)
    });
    return { order: order || await Order.findOne(filter), transitioned: false, refundRequired: true };
  }
}

/**
 * Mark a still-pending online order as failed and give back what it was holding.
 * Never touches an order whose payment already succeeded.
 */
async function failPendingOrder({ orderId, razorpayOrderId, reason = 'payment_failed' }) {
  const filter = orderId ? { _id: orderId } : { 'payment.razorpayOrderId': razorpayOrderId };
  if (!orderId && !razorpayOrderId) return { order: null, transitioned: false };

  return runInTransaction(async (session) => {
    const order = await Order.findOneAndUpdate(
      { ...filter, status: 'pending', 'payment.status': 'pending' },
      { $set: { status: 'failed', 'payment.status': 'failed', 'payment.failureReason': reason } },
      { returnDocument: 'after', session }
    );
    if (!order) {
      return { order: await Order.findOne(filter).session(session), transitioned: false };
    }
    await releaseHeldResources(order, session);
    await order.save({ session });
    return { order, transitioned: true };
  });
}

async function releaseHeldResources(order, session) {
  if (order.stockState === 'reserved') {
    await releaseStock(
      order.stockReservation.map(l => ({ product: l.product, size: l.size, quantity: l.quantity })),
      session
    );
    order.stockState = 'released';
  }
  if (order.voucher?.voucherId && order.voucher.usageApplied) {
    await voucherService.releaseVoucher({
      voucherId: order.voucher.voucherId,
      userId: customerIdOf(order),
      session
    });
    order.voucher.usageApplied = false;
  }
}

/**
 * Give back an order's stock / voucher hold when staff move it to cancelled or
 * failed. The stockState flip is the guard, so it can only happen once.
 */
async function releaseOrderHoldings(orderId) {
  return runInTransaction(async (session) => {
    const order = await Order.findOneAndUpdate(
      { _id: orderId, stockState: 'reserved' },
      { $set: { stockState: 'released' } },
      { returnDocument: 'after', session }
    );
    if (!order) return { released: false };
    await releaseStock(
      order.stockReservation.map(l => ({ product: l.product, size: l.size, quantity: l.quantity })),
      session
    );
    if (order.voucher?.voucherId && order.voucher.usageApplied) {
      await voucherService.releaseVoucher({ voucherId: order.voucher.voucherId, userId: customerIdOf(order), session });
      await Order.updateOne({ _id: order._id }, { $set: { 'voucher.usageApplied': false } }, { session });
    }
    return { released: true };
  });
}

/**
 * Put a PAID online order on the manual-refund list. No-op for unpaid and COD
 * orders, and for orders that are already listed or already refunded, so it is
 * safe to call on every cancellation path.
 */
async function markRefundRequiredIfPaid(orderId, reason) {
  const result = await Order.updateOne(
    { _id: orderId, 'payment.status': 'success', 'payment.refundStatus': { $nin: ['required', 'completed'] } },
    { $set: refundRequiredFields(reason) }
  );
  return result.modifiedCount === 1;
}

/** Staff moved an order to cancelled / failed: give back its holdings and list it for refund if it was paid. */
async function handleStaffCancellation(orderId, reason = 'cancelled_by_staff') {
  await releaseOrderHoldings(orderId);
  return markRefundRequiredIfPaid(orderId, reason);
}

/**
 * Staff confirm that a refund was issued by hand. The conditional update is the
 * guard: of several simultaneous clicks only one records the refund.
 * @returns the updated order, or null when the order is not awaiting a refund
 */
async function completeManualRefund({ orderId, adminId, reference, note }) {
  return Order.findOneAndUpdate(
    { _id: orderId, 'payment.refundRequired': true },
    {
      $set: {
        'payment.refundRequired': false,
        'payment.refundStatus': 'completed',
        'payment.refundedAt': new Date(),
        'payment.refundedBy': adminId,
        'payment.refundReference': reference,
        'payment.refundNote': note || undefined
      }
    },
    { returnDocument: 'after' }
  );
}

const NON_CANCELLABLE = ['out_for_delivery', 'delivered', 'cancelled'];

/**
 * Cancel an order and return its stock / voucher use exactly once.
 * @returns {{ order, previousStatus, transitioned }}
 */
async function cancelOrder({ orderId }) {
  return runInTransaction(async (session) => {
    const current = await Order.findById(orderId).session(session);
    if (!current) return { order: null, transitioned: false };
    if (NON_CANCELLABLE.includes(current.status)) {
      return { order: current, previousStatus: current.status, transitioned: false };
    }

    const previousStatus = current.status;
    const order = await Order.findOneAndUpdate(
      { _id: current._id, status: previousStatus },
      { $set: { status: 'cancelled' } },
      { returnDocument: 'after', session }
    );
    if (!order) return { order: current, previousStatus, transitioned: false };

    if (order.stockState === 'none' && previousStatus === 'confirmed') {
      // Order from before reservation existed: its stock was deducted at confirmation.
      await releaseStock(order.items.map(i => ({ product: i.product, size: i.size, quantity: i.quantity })), session);
      order.stockState = 'released';
    }
    await releaseHeldResources(order, session);

    if (order.payment?.status === 'success' && order.payment.refundStatus !== 'completed') {
      order.payment.refundRequired = true;
      order.payment.refundStatus = 'required';
      order.payment.refundReason = 'order_cancelled';
      order.payment.refundRequestedAt = new Date();
    }
    await order.save({ session });
    return { order, previousStatus, transitioned: true };
  });
}

/**
 * Abandoned checkouts must not hold stock forever: fail online orders that have
 * been awaiting payment for longer than the hold window.
 */
async function expireStalePendingOrders({ limit = 50 } = {}) {
  const cutoff = new Date(Date.now() - PAYMENT_HOLD_MINUTES() * 60 * 1000);
  const stale = await Order.find({
    status: 'pending',
    stockState: 'reserved',
    'payment.status': 'pending',
    createdAt: { $lt: cutoff }
  }).select('_id').limit(limit).lean();

  let expired = 0;
  for (const { _id } of stale) {
    try {
      const result = await failPendingOrder({ orderId: _id, reason: 'payment_timeout' });
      if (result.transitioned) expired += 1;
    } catch (err) {
      logger.error(`Failed to expire pending order ${_id}`, err);
    }
  }
  return expired;
}

module.exports = {
  NON_CANCELLABLE,
  runInTransaction,
  createOrderWithReservation,
  confirmPaidOrder,
  failPendingOrder,
  cancelOrder,
  releaseOrderHoldings,
  markRefundRequiredIfPaid,
  handleStaffCancellation,
  completeManualRefund,
  expireStalePendingOrders
};
