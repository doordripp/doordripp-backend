/**
 * Shared test harness: in-memory MongoDB replica set (transactions need one),
 * stubs for everything that talks to the outside world, and small factories.
 */
const crypto = require('crypto');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const sent = { otps: [], emails: [], confirmedEffects: [] };

const asyncStubModule = (overrides = {}) => new Proxy(overrides, {
  get(target, prop) {
    if (prop in target) return target[prop];
    if (prop === '__esModule' || prop === 'then') return undefined;
    target[prop] = jest.fn(async () => ({ success: true }));
    return target[prop];
  }
});

jest.doMock('../../src/services/mail.service', () => asyncStubModule({
  sendOtpEmail: jest.fn(async (email, otp, purpose) => { sent.otps.push({ email, otp, purpose }); return { success: true }; }),
  sendOrderConfirmation: jest.fn(async (payload) => { sent.confirmedEffects.push(payload.orderId); return { success: true }; })
}));
jest.doMock('../../src/utils/email', () => ({
  sendEmailOTP: jest.fn(async (email, otp) => { sent.otps.push({ email, otp, purpose: 'email' }); return { success: true }; })
}));
// 'natural' pulls in an ESM-only dependency that jest cannot require; search is not under test here.
jest.doMock('natural', () => ({ PorterStemmer: { stem: (word) => String(word || '') } }));
jest.doMock('../../src/services/pushNotification.service', () => asyncStubModule());
jest.doMock('../../src/services/notification.service', () => asyncStubModule());
jest.doMock('../../src/services/invoiceService', () => ({
  generateInvoice: jest.fn(async () => ({ invoice: { invoiceNumber: 'TEST/1' }, pdfPath: 'unused.pdf' })),
  getInvoiceByOrderId: jest.fn(async () => null),
  getInvoiceById: jest.fn(async () => { throw new Error('Invoice not found'); }),
  getInvoiceByNumber: jest.fn(async () => { throw new Error('Invoice not found'); }),
  listInvoices: jest.fn(async () => ({ invoices: [], total: 0, page: 1, totalPages: 0 })),
  generateInvoicePDF: jest.fn(async () => 'unused.pdf'),
  getPDFUrl: jest.fn(() => '/invoices/unused.pdf')
}));
jest.doMock('../../src/utils/razorpay', () => {
  const actual = jest.requireActual('../../src/utils/razorpay');
  return {
    ...actual,
    createOrder: jest.fn(async ({ amount }) => ({ id: `order_${require('crypto').randomBytes(8).toString('hex')}`, amount, currency: 'INR' }))
  };
});

let replSet;

async function startDb() {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(replSet.getUri(), { dbName: 'doordripp_test' });
}

async function stopDb() {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
}

async function clearDb() {
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map(c => c.deleteMany({})));
  sent.otps.length = 0;
  sent.emails.length = 0;
  sent.confirmedEffects.length = 0;
}

/** Build indexes (unique constraints) and create collections up front, as a deployed database has them. */
async function syncIndexes() {
  await Promise.all(Object.values(mongoose.models).map(async (model) => {
    await model.createCollection().catch(() => {});
    await model.syncIndexes().catch(() => {});
  }));
}

const getApp = () => require('../../src/app').app;

let counter = 0;
const unique = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

async function createUser(overrides = {}) {
  const User = require('../../src/models/User');
  const id = unique();
  const user = new User({
    name: 'Test User',
    email: `user-${id}@example.com`,
    password: 'Password123!',
    emailVerified: true,
    termsAccepted: true,
    isPasswordSet: true,
    roles: [],
    ...overrides
  });
  await user.save();
  return user;
}

const tokenFor = (user) => require('../../src/config/auth').signAuthToken(user);
const bearer = (userOrToken) => ({
  Authorization: `Bearer ${typeof userOrToken === 'string' ? userOrToken : tokenFor(userOrToken)}`
});

async function createProduct(overrides = {}) {
  const Product = require('../../src/models/Product');
  const id = unique();
  return Product.create({
    name: `Product ${id}`,
    slug: `product-${id}`,
    price: 1000,
    gstRate: 5,
    sizeInventory: [{ size: 'M', stock: 1 }],
    ...overrides
  });
}

async function createVoucher(overrides = {}) {
  const Voucher = require('../../src/models/Voucher');
  return Voucher.create({
    code: `SAVE${unique()}`.toUpperCase(),
    discountType: 'fixed',
    discountValue: 100,
    usageLimit: null,
    perUserLimit: 1,
    ...overrides
  });
}

const shippingAddress = { name: 'Buyer', phone: '9876543210', line1: '1 Test Street', city: 'Pune', state: 'MH', pincode: '411001' };

const orderBody = (product, extra = {}) => ({
  items: [{ product: String(product._id), quantity: 1, selectedSize: 'M', ...(extra.item || {}) }],
  shippingAddress,
  paymentMethod: 'cod',
  ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== 'item'))
});

const razorpaySignature = (razorpayOrderId, paymentId) =>
  crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${razorpayOrderId}|${paymentId}`).digest('hex');

const webhookSignature = (rawBody) =>
  crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest('hex');

const stockOf = async (productId, size = 'M') => {
  const Product = require('../../src/models/Product');
  const product = await Product.findById(productId).lean();
  const entry = (product.sizeInventory || []).find(e => e.size === size);
  return entry ? entry.stock : product.stock;
};

module.exports = {
  sent,
  startDb,
  stopDb,
  clearDb,
  syncIndexes,
  getApp,
  createUser,
  tokenFor,
  bearer,
  createProduct,
  createVoucher,
  orderBody,
  shippingAddress,
  razorpaySignature,
  webhookSignature,
  stockOf
};
