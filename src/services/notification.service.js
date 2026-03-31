const Notification = require('../models/Notification');
const User = require('../models/User');

const MANAGEMENT_ORDER_URL_TEMPLATE = '/manager/orders/:orderId';

const normalizeId = (value) => String(value || '').trim();

function formatCurrency(amount) {
  const numericAmount = Number(amount) || 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(numericAmount);
}

async function getAdminRecipients() {
  return User.find({
    roles: 'admin',
    isBanned: false
  }).select('_id roles');
}

async function createNewOrderNotifications({ order, deliveryInfo, customerName }) {
  if (!order?._id) return [];

  const admins = await getAdminRecipients();
  const managerRecipients = Array.isArray(deliveryInfo?.managers) ? deliveryInfo.managers : [];
  const recipientMap = new Map();

  admins.forEach((admin) => {
    const userId = normalizeId(admin._id);
    if (!userId) return;

    recipientMap.set(userId, {
      recipient: admin._id,
      audienceRole: 'admin'
    });
  });

  managerRecipients.forEach((manager) => {
    const userId = normalizeId(manager._id);
    if (!userId || recipientMap.has(userId)) return;

    recipientMap.set(userId, {
      recipient: manager._id,
      audienceRole: 'manager'
    });
  });

  if (!recipientMap.size) return [];

  const orderTypeLabel = order.isTrial ? 'New Trial Order' : 'New Order';
  const zoneName = deliveryInfo?.zone?.name || 'Unassigned Area';
  const itemCount = Array.isArray(order.items) ? order.items.length : 0;
  const totalLabel = formatCurrency(order.total);
  const orderId = normalizeId(order._id);
  const actionUrl = MANAGEMENT_ORDER_URL_TEMPLATE.replace(':orderId', orderId);
  const title = `${orderTypeLabel} Received`;
  const message = `${customerName || 'A customer'} placed an order for ${totalLabel} in ${zoneName}.`;
  const metadata = {
    orderId,
    customerName: customerName || 'Customer',
    total: Number(order.total) || 0,
    itemCount,
    isTrial: Boolean(order.isTrial),
    zoneName,
    shippingCity: order.shippingAddress?.city || '',
    shippingPincode: order.shippingAddress?.pincode || order.shippingAddress?.zip || ''
  };

  const notifications = Array.from(recipientMap.values()).map((recipient) => ({
    ...recipient,
    type: 'order_created',
    category: 'orders',
    title,
    message,
    order: order._id,
    deliveryZone: deliveryInfo?.zone?._id || null,
    actionUrl,
    metadata
  }));

  return Notification.insertMany(notifications, { ordered: false });
}

module.exports = {
  MANAGEMENT_ORDER_URL_TEMPLATE,
  createNewOrderNotifications
};
