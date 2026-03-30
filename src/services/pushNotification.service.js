/**
 * OneSignal Push Notification Service
 * Sends push notifications to admin/manager users when orders are placed.
 */

const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID;
const ONESIGNAL_REST_API_KEY = process.env.ONESIGNAL_REST_API_KEY;

/**
 * Send a push notification to all admins and managers
 * Uses tag-based filtering: role = admin OR role = manager
 */
async function sendToAdminsAndManagers({ heading, content, data = {}, url }) {
  if (!ONESIGNAL_APP_ID || !ONESIGNAL_REST_API_KEY) {
    console.warn('⚠️ OneSignal: Missing APP_ID or REST_API_KEY. Skipping push notification.');
    return null;
  }

  try {
    const payload = {
      app_id: ONESIGNAL_APP_ID,
      headings: { en: heading },
      contents: { en: content },
      filters: [
        { field: 'tag', key: 'role', relation: '=', value: 'admin' },
        { operator: 'OR' },
        { field: 'tag', key: 'role', relation: '=', value: 'manager' }
      ],
      data,
      ...(url && { url }),
      chrome_web_icon: 'https://doordripp.com/logo_finalW.png',
      chrome_web_badge: 'https://doordripp.com/logo_finalW.png'
    };

    const response = await fetch('https://api.onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (result.errors) {
      console.error('❌ OneSignal notification error:', result.errors);
    } else {
      console.log(`✅ OneSignal: Push sent to ${result.recipients || 0} admin/manager(s). ID: ${result.id}`);
    }

    return result;
  } catch (err) {
    console.error('❌ OneSignal push notification failed:', err.message);
    return null;
  }
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
    url: `https://doordripp.com/admin/orders/${orderId}`
  });
}

module.exports = {
  sendToAdminsAndManagers,
  notifyNewOrder
};
