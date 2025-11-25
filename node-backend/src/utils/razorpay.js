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

const verifySignature = (payload, signature, secret) => {
  // Implement signature verification for webhooks if needed
  return true; // placeholder — replace with real verification logic
};

module.exports = { instance, createOrder, verifySignature };
