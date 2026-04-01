require('dotenv').config();

const crypto = require('crypto');
const Razor = require('../src/utils/razorpay');

const results = [];
const secret = String(process.env.RAZORPAY_KEY_SECRET || '').trim();

if (!secret) {
  console.log('SMOKE_FAIL: missing RAZORPAY_KEY_SECRET in env');
  process.exit(1);
}

const orderId = 'order_test_123';
const paymentId = 'pay_test_456';
const validSig = crypto
  .createHmac('sha256', secret)
  .update(`${orderId}|${paymentId}`)
  .digest('hex');

const ok = Razor.verifyPaymentSignature(orderId, paymentId, validSig);
results.push(['verifyPaymentSignature_valid', ok]);

const bad = Razor.verifyPaymentSignature(orderId, paymentId, 'deadbeef');
results.push(['verifyPaymentSignature_invalid', !bad]);

const payload = JSON.stringify({
  event: 'payment.captured',
  payload: { payment: { entity: { id: 'pay_x' } } }
});

const webhookSig = crypto
  .createHmac('sha256', secret)
  .update(payload)
  .digest('hex');

const webhookOk = Razor.verifySignature(payload, webhookSig, secret);
results.push(['verifySignature_valid_raw_string', webhookOk]);

const webhookBad = Razor.verifySignature(payload, '00', secret);
results.push(['verifySignature_invalid', !webhookBad]);

let missingSecretThrows = false;
const originalSecret = process.env.RAZORPAY_KEY_SECRET;
try {
  process.env.RAZORPAY_KEY_SECRET = '';
  Razor.verifySignature(payload, webhookSig, '');
} catch (err) {
  missingSecretThrows = true;
} finally {
  process.env.RAZORPAY_KEY_SECRET = originalSecret;
}
results.push(['verifySignature_missing_secret_throws', missingSecretThrows]);

const pass = results.every(([, value]) => value === true);
for (const [name, value] of results) {
  console.log(`${name}: ${value ? 'PASS' : 'FAIL'}`);
}
console.log(`SMOKE_RESULT: ${pass ? 'PASS' : 'FAIL'}`);

if (!pass) process.exit(1);
