/**
 * OneSignal Push Notification Service
 *
 * Two audiences are supported:
 *  - Admins/managers: targeted by OneSignal tags (role = admin | manager).
 *  - Customers: targeted by OneSignal External ID, which the client apps set via
 *    OneSignal.login(userId) using the Mongo User._id. The backend therefore sends
 *    to include_aliases.external_id = [String(order.customer._id)].
 *
 * Every exported notify* function is fire-and-forget safe: it resolves to null on
 * failure and never throws, so a push problem can never roll back an order,
 * payment or status update.
 */

const Order = require('../models/Order');

const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID;
const ONESIGNAL_REST_API_KEY = process.env.ONESIGNAL_REST_API_KEY;

// Separate credentials for the mobile app (customer-facing push notifications)
const APP_ONESIGNAL_APP_ID = process.env.APP_ONESIGNAL_APP_ID;
const APP_ONESIGNAL_REST_API_KEY = process.env.APP_ONESIGNAL_REST_API_KEY;

// Current OneSignal REST endpoint. The legacy `/api/v1/notifications` path is still
// accepted but is no longer the documented one.
const ONESIGNAL_API_URL = 'https://api.onesignal.com/notifications';

const WEB_ICON = 'https://doordripp.com/logo_finalW.png';

/**
 * New-format keys (os_v2_app_...) authenticate with the `Key` scheme; the older
 * REST API keys still use `Basic`. Detected from the key itself so a key rotation
 * does not silently break push delivery.
 */
function buildAuthorizationHeader(key) {
  return /^os_v2_/i.test(key) ? `Key ${key}` : `Basic ${key}`;
}

/**
 * Customer-facing order reference. Matches the existing email/template convention
 * (`Order Confirmation - #${orderId}`), which uses the raw order _id.
 */
function orderNumberOf(order) {
  return String(order?._id || '');
}

/**
 * Resolve the OneSignal External ID for an order's customer. `customer` may be a
 * raw ObjectId or a populated User document.
 */
function externalIdOf(order) {
  const customer = order?.customer;
  return String(customer?._id || customer || '').trim();
}

async function send(payload) {
  if (!ONESIGNAL_APP_ID || !ONESIGNAL_REST_API_KEY) {
    console.warn('⚠️ OneSignal: Missing APP_ID or REST_API_KEY. Skipping push notification.');
    return null;
  }

  try {
    const response = await fetch(ONESIGNAL_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': buildAuthorizationHeader(ONESIGNAL_REST_API_KEY)
      },
      body: JSON.stringify({ app_id: ONESIGNAL_APP_ID, ...payload })
    });

    const result = await response.json();

    if (result.errors) {
      console.error('❌ OneSignal notification error:', result.errors);
    } else {
      console.log(`✅ OneSignal: Push sent to ${result.recipients || 0} recipient(s). ID: ${result.id}`);
    }

    return result;
  } catch (err) {
    console.error('❌ OneSignal push notification failed:', err.message);
    return null;
  }
}

/**
 * Send a push notification via the app-specific OneSignal account.
 * Used for customer-facing notifications sent to the mobile app.
 */
async function sendApp(payload) {
  if (!APP_ONESIGNAL_APP_ID || !APP_ONESIGNAL_REST_API_KEY) {
    console.warn('⚠️ OneSignal App: Missing APP_ONESIGNAL_APP_ID or APP_ONESIGNAL_REST_API_KEY. Skipping push notification.');
    return null;
  }

  try {
    const response = await fetch(ONESIGNAL_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': buildAuthorizationHeader(APP_ONESIGNAL_REST_API_KEY)
      },
      body: JSON.stringify({ app_id: APP_ONESIGNAL_APP_ID, ...payload })
    });

    const result = await response.json();

    if (result.errors) {
      console.error('❌ OneSignal App notification error:', result.errors);
    } else {
      console.log(`✅ OneSignal App: Push sent to ${result.recipients || 0} recipient(s). ID: ${result.id}`);
    }

    return result;
  } catch (err) {
    console.error('❌ OneSignal App push notification failed:', err.message);
    return null;
  }
}

/**
 * Send a push notification to all admins and managers
 * Uses tag-based filtering: role = admin OR role = manager
 */
async function sendToAdminsAndManagers({ heading, content, data = {}, url }) {
  return send({
    headings: { en: heading },
    contents: { en: content },
    filters: [
      { field: 'tag', key: 'role', relation: '=', value: 'admin' },
      { operator: 'OR' },
      { field: 'tag', key: 'role', relation: '=', value: 'manager' }
    ],
    data,
    ...(url && { url }),
    chrome_web_icon: WEB_ICON,
    chrome_web_badge: WEB_ICON
  });
}

/**
 * Send a new order notification to all admins and managers
 */
async function notifyNewOrder({ orderId, customerName, total, itemCount, isTrial }) {
  const orderType = isTrial ? '📦 Trial Order' : '🛒 New Order';
  const heading = `${orderType} Received!`;
  const content = `${customerName} placed an order of ₹${total} (${itemCount} item${itemCount > 1 ? 's' : ''}). Tap to view.`;

  return sendToAdminsAndManagers({
    heading,
    content,
    data: { orderId, type: 'new_order' },
    url: `https://doordripp.com/manager/orders/${orderId}`
  });
}

/**
 * Deep-link contract expected by the Flutter DeepLinkHandler, which routes on
 * `route` + `id` read from OneSignal additionalData. Every customer order
 * notification uses this exact shape.
 */
const CUSTOMER_ORDER_ROUTE = '/order-detail';

/**
 * Send a push to exactly one customer, addressed by their External ID.
 * `data` carries the Flutter deep-link contract so tapping opens the order screen.
 */
async function sendToCustomer(order, { event, heading, content, extraData = {} }) {
  const externalId = externalIdOf(order);
  const orderId = String(order?._id || '');

  if (!externalId) {
    console.warn(`⚠️ OneSignal: no customer External ID on order ${orderId}. Skipping "${event}" push.`);
    return null;
  }

  console.log(`📲 OneSignal: sending "${event}" push for order ${orderId} to external_id ${externalId}`);

  return sendApp({
    headings: { en: heading },
    contents: { en: content },
    include_aliases: { external_id: [externalId] },
    target_channel: 'push',
    data: {
      // Supplementary metadata first, so it can never shadow the deep-link contract.
      type: event,
      ...extraData,
      // Flutter DeepLinkHandler contract — must stay exactly these two keys.
      route: CUSTOMER_ORDER_ROUTE,
      id: orderId
    },
    chrome_web_icon: WEB_ICON,
    chrome_web_badge: WEB_ICON
  });
}

/**
 * Atomically claim the right to send a one-shot push for this order, so that two
 * code paths racing on the same event (e.g. verifyPayment and the Razorpay webhook)
 * can never both send it. Returns true only for the caller that won the claim.
 */
async function claimOneShotPush(orderId, flag) {
  const path = `pushFlags.${flag}`;

  const result = await Order.updateOne(
    { _id: orderId, $or: [{ [path]: null }, { [path]: { $exists: false } }] },
    { $set: { [path]: new Date() } }
  );

  return result.modifiedCount === 1;
}

/**
 * Claim the right to push for a status, so the same status is never pushed twice
 * even if it is written again or updated through a different endpoint.
 */
async function claimStatusPush(orderId, status) {
  const result = await Order.updateOne(
    { _id: orderId, 'pushFlags.lastStatusPushed': { $ne: status } },
    { $set: { 'pushFlags.lastStatusPushed': status } }
  );

  return result.modifiedCount === 1;
}

/**
 * Customer-facing copy per order status. Only statuses in the Order schema enum
 * are listed; anything else intentionally produces no push.
 */
const STATUS_PUSH_COPY = {
  confirmed: { heading: 'Order confirmed', body: 'Your order has been confirmed.' },
  accepted: { heading: 'Order accepted', body: 'Your order has been accepted and is being prepared.' },
  picked_up: { heading: 'Order picked up', body: 'Your order has been picked up.' },
  out_for_delivery: { heading: 'Out for delivery', body: 'Your order is out for delivery.' },
  delivered: { heading: 'Order delivered', body: 'Your order has been delivered.' },
  cancelled: { heading: 'Order cancelled', body: 'Your order has been cancelled.' }
};

/**
 * "Order confirmed" push. Safe to call from every confirmation path (COD creation,
 * verifyPayment, Razorpay webhook) — only the first call for an order sends.
 */
async function notifyCustomerOrderConfirmed(order) {
  try {
    if (!order?._id) return null;

    const claimed = await claimOneShotPush(order._id, 'orderConfirmedSentAt');
    if (!claimed) {
      console.log(`ℹ️ OneSignal: "order confirmed" push already sent for order ${order._id}. Skipping duplicate.`);
      return null;
    }

    // Keep the status tracker in sync so the status-change hook does not re-announce
    // the same 'confirmed' transition right after this.
    await claimStatusPush(order._id, 'confirmed');

    return await sendToCustomer(order, {
      event: 'order_confirmed',
      heading: 'Order confirmed',
      content: `Your order #${orderNumberOf(order)} has been confirmed.`,
      extraData: { status: 'confirmed' }
    });
  } catch (err) {
    console.error('❌ OneSignal: order confirmed push failed:', err.message);
    return null;
  }
}

/**
 * "Order status changed" push. No-ops when the status did not actually change,
 * when the status has no customer-facing copy, or when that status was already
 * pushed for this order.
 */
async function notifyCustomerOrderStatusChange(order, previousStatus, newStatus) {
  try {
    if (!order?._id) return null;
    if (!newStatus || previousStatus === newStatus) return null;

    const copy = STATUS_PUSH_COPY[newStatus];
    if (!copy) return null;

    const claimed = await claimStatusPush(order._id, newStatus);
    if (!claimed) {
      console.log(`ℹ️ OneSignal: "${newStatus}" push already sent for order ${order._id}. Skipping duplicate.`);
      return null;
    }

    return await sendToCustomer(order, {
      event: 'order_status',
      heading: copy.heading,
      content: copy.body,
      extraData: { status: newStatus, previousStatus: previousStatus || null }
    });
  } catch (err) {
    console.error('❌ OneSignal: order status push failed:', err.message);
    return null;
  }
}

/**
 * "Payment failed" push. Only the first failure event for an order sends,
 * so repeated webhook deliveries do not notify twice.
 */
async function notifyCustomerPaymentFailed(order) {
  try {
    if (!order?._id) return null;

    const claimed = await claimOneShotPush(order._id, 'paymentFailedSentAt');
    if (!claimed) {
      console.log(`ℹ️ OneSignal: "payment failed" push already sent for order ${order._id}. Skipping duplicate.`);
      return null;
    }

    return await sendToCustomer(order, {
      event: 'payment_failed',
      heading: 'Payment failed',
      content: `Payment for order #${orderNumberOf(order)} failed. Please retry.`,
      extraData: { status: 'failed' }
    });
  } catch (err) {
    console.error('❌ OneSignal: payment failed push failed:', err.message);
    return null;
  }
}

module.exports = {
  sendToAdminsAndManagers,
  notifyNewOrder,
  notifyCustomerOrderConfirmed,
  notifyCustomerOrderStatusChange,
  notifyCustomerPaymentFailed
};
