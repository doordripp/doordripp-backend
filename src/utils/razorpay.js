const Razorpay = require('razorpay');

let instance;
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
  instance = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
  });
} else {
  instance = null;
}

const createOrder = async ({ amount, currency = 'INR', receipt = undefined }) => {
  if (!instance) throw new Error('Razorpay keys not set in environment');
  const options = { amount, currency };
  if (receipt) options.receipt = receipt;
  return instance.orders.create(options);
};

const crypto = require('crypto');

const verifySignature = (payload, signature, secret) => {
  // Verify Razorpay signature for webhook/payment validation
  const generatedSignature = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');
  
  return generatedSignature === signature;
};

const verifyPaymentSignature = (razorpayOrderId, razorpayPaymentId, razorpaySignature) => {
  // Verify payment signature using order and payment IDs
  const body = `${razorpayOrderId}|${razorpayPaymentId}`;
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '')
    .update(body)
    .digest('hex');
  
  const isValid = expectedSignature === razorpaySignature;
  
  // In test mode, log for debugging
  if (!isValid && process.env.RAZORPAY_KEY_ID?.includes('rzp_test')) {
    const logger = require('./logger');
    logger.warn('Signature mismatch (test mode). Expected vs received hashes differ.');
  }
  
  return isValid;
};

module.exports = { instance, createOrder, verifySignature, verifyPaymentSignature };
