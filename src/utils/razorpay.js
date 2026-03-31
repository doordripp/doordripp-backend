const Razorpay = require('razorpay');
const crypto = require('crypto');

const SUPPORTED_CURRENCIES = new Set(['INR']);

let instance;
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
  instance = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
  });
} else {
  instance = null;
}

const getConfiguredSecret = (overrideSecret) => {
  const candidate = String(overrideSecret || process.env.RAZORPAY_KEY_SECRET || '').trim();
  if (!candidate) {
    throw new Error('Razorpay secret is not configured');
  }
  return candidate;
};

const timingSafeHexCompare = (expectedHex, providedHex) => {
  if (typeof expectedHex !== 'string' || typeof providedHex !== 'string') return false;

  const expectedBuffer = Buffer.from(expectedHex, 'hex');
  const providedBuffer = Buffer.from(providedHex, 'hex');

  if (!expectedBuffer.length || expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
};

const createOrder = async ({ amount, currency = 'INR', receipt = undefined }) => {
  if (!instance) throw new Error('Razorpay keys not set in environment');

  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error('Razorpay order amount must be a positive integer in paise');
  }

  const normalizedCurrency = String(currency || 'INR').trim().toUpperCase();
  if (!SUPPORTED_CURRENCIES.has(normalizedCurrency)) {
    throw new Error(`Unsupported Razorpay currency: ${normalizedCurrency}`);
  }

  const normalizedReceipt = String(receipt || '').trim();
  if (!normalizedReceipt) {
    throw new Error('Razorpay order receipt is required');
  }
  if (normalizedReceipt.length > 40) {
    throw new Error('Razorpay receipt must be 40 characters or fewer');
  }

  const options = { amount, currency: normalizedCurrency, receipt: normalizedReceipt };
  return instance.orders.create(options);
};

const verifySignature = (payload, signature, secret) => {
  // Verify Razorpay signature for webhook/payment validation.
  // Prefer passing req.rawBody for webhook validation.
  const configuredSecret = getConfiguredSecret(secret);
  const payloadForHash = Buffer.isBuffer(payload)
    ? payload
    : (typeof payload === 'string' ? payload : JSON.stringify(payload));

  const generatedSignature = crypto
    .createHmac('sha256', configuredSecret)
    .update(payloadForHash)
    .digest('hex');

  return timingSafeHexCompare(generatedSignature, String(signature || ''));
};

const verifyPaymentSignature = (razorpayOrderId, razorpayPaymentId, razorpaySignature) => {
  // Verify payment signature using order and payment IDs
  const configuredSecret = getConfiguredSecret();
  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    return false;
  }

  const body = `${razorpayOrderId}|${razorpayPaymentId}`;
  const expectedSignature = crypto
    .createHmac('sha256', configuredSecret)
    .update(body)
    .digest('hex');

  return timingSafeHexCompare(expectedSignature, String(razorpaySignature || ''));
};

module.exports = { instance, createOrder, verifySignature, verifyPaymentSignature };
