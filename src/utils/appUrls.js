const DEFAULT_CLIENT_URL = 'http://localhost:5173';

function getClientUrl() {
  return process.env.FRONTEND_URL || process.env.CLIENT_URL || DEFAULT_CLIENT_URL;
}

function getOrderUrl(orderId) {
  return `${getClientUrl()}/orders/${orderId}`;
}

function getOrderTrackUrl(orderId) {
  return `${getClientUrl()}/order/${orderId}/track`;
}

function getAdminOrdersUrl(orderId) {
  return `${getClientUrl()}/admin/orders?id=${orderId}`;
}

function getAuthDocsUrl() {
  return `${getClientUrl()}/docs/api/auth`;
}

module.exports = {
  getAdminOrdersUrl,
  getAuthDocsUrl,
  getClientUrl,
  getOrderTrackUrl,
  getOrderUrl,
};