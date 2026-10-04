const request = require('supertest');
const h = require('./helpers/setup');

let app;
beforeAll(async () => { await h.startDb(); app = h.getApp(); await h.syncIndexes(); });
afterAll(h.stopDb);
beforeEach(h.clearDb);

const Order = () => require('../src/models/Order');
const Voucher = () => require('../src/models/Voucher');
const VoucherUsage = () => require('../src/models/VoucherUsage');
const place = (user, body) => request(app).post('/api/orders').set(h.bearer(user)).send(body);
const count = (results, status) => results.filter(r => r.status === status).length;

const verify = (user, order, paymentId = 'pay_test_1', signature) =>
  request(app).post(`/api/orders/${order._id}/verify-payment`).set(h.bearer(user)).send({
    orderId: order._id,
    razorpayPaymentId: paymentId,
    razorpaySignature: signature || h.razorpaySignature(order.payment.razorpayOrderId, paymentId)
  });

const webhook = (event, order, { paymentId = 'pay_test_1', amount, signature } = {}) => {
  const raw = JSON.stringify({
    event,
    payload: { payment: { entity: { id: paymentId, order_id: order.payment.razorpayOrderId, amount: amount ?? Math.round(order.total * 100), currency: 'INR' } } }
  });
  return request(app).post('/webhooks/razorpay')
    .set('Content-Type', 'application/json')
    .set('x-razorpay-signature', signature || h.webhookSignature(raw))
    .send(raw);
};

const usedCount = async (voucher) => (await Voucher().findById(voucher._id)).usedCount;
const userUses = async (voucher, user) => (await VoucherUsage().findOne({ voucher: voucher._id, user: user._id }))?.count || 0;

async function onlineOrder({ stock = 5, voucher, user } = {}) {
  const product = await h.createProduct({ sizeInventory: [{ size: 'M', stock }], price: 1000 });
  const buyer = user || await h.createUser();
  const res = await place(buyer, h.orderBody(product, { paymentMethod: 'online', ...(voucher ? { voucherCode: voucher.code } : {}) }));
  expect(res.status).toBe(201);
  return { product, buyer, order: res.body.order, razorOrder: res.body.razorOrder };
}

describe('payment confirmation is idempotent and concurrency-safe', () => {
  test('verify-payment and the webhook racing: one transition, stock once, voucher once, effects once', async () => {
    const voucher = await h.createVoucher({ usageLimit: 5 });
    const { product, buyer, order } = await onlineOrder({ stock: 5, voucher });
    expect(await h.stockOf(product._id)).toBe(4); // held since checkout

    const results = await Promise.all([
      verify(buyer, order),
      webhook('payment.captured', order),
      verify(buyer, order),
      webhook('payment.captured', order)
    ]);
    expect(results.every(r => r.status === 200)).toBe(true);

    const saved = await Order().findById(order._id);
    expect(saved.status).toBe('confirmed');
    expect(saved.payment.status).toBe('success');
    expect(await h.stockOf(product._id)).toBe(4);
    expect(await usedCount(voucher)).toBe(1);
    expect(await userUses(voucher, buyer)).toBe(1);
    expect(saved.statusHistory.filter(e => e.status === 'confirmed')).toHaveLength(1);
    expect(h.sent.confirmedEffects.filter(id => id === String(order._id))).toHaveLength(1);
  });

  test('repeating verify-payment later changes nothing (the app retries it)', async () => {
    const { product, buyer, order } = await onlineOrder({ stock: 3 });
    expect((await verify(buyer, order)).status).toBe(200);
    for (let i = 0; i < 3; i++) {
      const res = await verify(buyer, order);
      expect(res.status).toBe(200);
      expect(res.body.order.status).toBe('confirmed');
    }
    await webhook('payment.captured', order);
    expect(await h.stockOf(product._id)).toBe(2);
    expect(h.sent.confirmedEffects).toHaveLength(1);
  });

  test('webhook alone confirms the order (app killed before verify) and runs the effects once', async () => {
    const { product, order } = await onlineOrder({ stock: 3 });
    expect((await webhook('payment.captured', order)).status).toBe(200);
    expect((await webhook('payment.captured', order)).body.duplicate).toBe(true);
    expect((await Order().findById(order._id)).status).toBe('confirmed');
    expect(await h.stockOf(product._id)).toBe(2);
    expect(h.sent.confirmedEffects).toHaveLength(1);
  });

  test('a failed payment gives back the stock and the voucher use', async () => {
    const voucher = await h.createVoucher({ usageLimit: 1 });
    const { product, buyer, order } = await onlineOrder({ stock: 1, voucher });
    expect(await h.stockOf(product._id)).toBe(0);
    expect(await usedCount(voucher)).toBe(1);

    const failed = () => request(app).post(`/api/orders/${order._id}/payment-failed`).set(h.bearer(buyer)).send({ orderId: order._id });
    const results = await Promise.all([failed(), failed(), webhook('payment.failed', order)]);
    expect(results.every(r => r.status === 200)).toBe(true);

    const saved = await Order().findById(order._id);
    expect(saved.status).toBe('failed');
    expect(saved.payment.status).toBe('failed');
    expect(await h.stockOf(product._id)).toBe(1); // released once, not three times
    expect(await usedCount(voucher)).toBe(0);
    expect(await userUses(voucher, buyer)).toBe(0);

    // the voucher and the unit are usable again
    const again = await place(buyer, h.orderBody(product, { voucherCode: voucher.code }));
    expect(again.status).toBe(201);
  });

  test('a successful payment cannot be reverted by payment-failed or a late failed webhook', async () => {
    const { product, buyer, order } = await onlineOrder({ stock: 2 });
    await verify(buyer, order);

    const res = await request(app).post(`/api/orders/${order._id}/payment-failed`).set(h.bearer(buyer)).send({ orderId: order._id });
    expect(res.status).toBe(200);
    await webhook('payment.failed', order);

    const saved = await Order().findById(order._id);
    expect(saved.status).toBe('confirmed');
    expect(saved.payment.status).toBe('success');
    expect(await h.stockOf(product._id)).toBe(1);
  });

  test('failed attempt, then the customer retries and pays: confirmed, stock taken exactly once', async () => {
    const { product, buyer, order } = await onlineOrder({ stock: 1 });
    await webhook('payment.failed', order);
    expect(await h.stockOf(product._id)).toBe(1);

    const res = await verify(buyer, order, 'pay_retry');
    expect(res.status).toBe(200);
    expect((await Order().findById(order._id)).status).toBe('confirmed');
    expect(await h.stockOf(product._id)).toBe(0);
  });

  test('paid after the hold was released and the item sold out: not confirmed, flagged for refund, no oversell', async () => {
    const { product, buyer, order } = await onlineOrder({ stock: 1 });
    await webhook('payment.failed', order);                       // hold released
    expect((await place(await h.createUser(), h.orderBody(product))).status).toBe(201); // someone else buys the last unit
    expect(await h.stockOf(product._id)).toBe(0);

    const res = await verify(buyer, order, 'pay_late');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('REFUND_REQUIRED');
    const saved = await Order().findById(order._id);
    expect(saved.status).toBe('failed');
    expect(saved.payment.status).toBe('success');
    expect(saved.payment.refundRequired).toBe(true);
    expect(await h.stockOf(product._id)).toBe(0);
  });

  test('an invalid signature neither confirms nor fails the order, and holds stay in place', async () => {
    const { product, buyer, order } = await onlineOrder({ stock: 1 });
    const res = await verify(buyer, order, 'pay_x', 'deadbeef');
    expect(res.status).toBe(400);
    const saved = await Order().findById(order._id);
    expect(saved.status).toBe('pending');
    expect(saved.payment.status).toBe('pending');
    expect(await h.stockOf(product._id)).toBe(0);
  });

  test("a signature for a different order's Razorpay id is rejected", async () => {
    const one = await onlineOrder({ stock: 2 });
    const two = await onlineOrder({ stock: 2 });
    const res = await verify(one.buyer, one.order, 'pay_1', h.razorpaySignature(two.order.payment.razorpayOrderId, 'pay_1'));
    expect(res.status).toBe(400);
  });

  test("a user cannot verify or fail another user's order", async () => {
    const { order } = await onlineOrder({ stock: 2 });
    const stranger = await h.createUser();
    expect((await verify(stranger, order)).status).toBe(403);
    const res = await request(app).post(`/api/orders/${order._id}/payment-failed`).set(h.bearer(stranger)).send({ orderId: order._id });
    expect(res.status).toBe(403);
    expect((await Order().findById(order._id)).status).toBe('pending');
  });

  test('webhook: bad signature and wrong amount are refused', async () => {
    const { order } = await onlineOrder({ stock: 2 });
    expect((await webhook('payment.captured', order, { signature: 'deadbeef' })).status).toBe(403);
    expect((await webhook('payment.captured', order, { amount: 100 })).body.ignored).toBe('amount_mismatch');
    expect((await Order().findById(order._id)).status).toBe('pending');
  });

  test('abandoned checkout: the hold expires and stock / voucher return', async () => {
    const voucher = await h.createVoucher({ usageLimit: 1 });
    const { product, order } = await onlineOrder({ stock: 1, voucher });
    await Order().collection.updateOne({ _id: (await Order().findById(order._id))._id }, { $set: { createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000) } });

    const { expireStalePendingOrders } = require('../src/services/orderLifecycle.service');
    expect(await expireStalePendingOrders()).toBe(1);
    expect(await expireStalePendingOrders()).toBe(0);

    expect((await Order().findById(order._id)).status).toBe('failed');
    expect(await h.stockOf(product._id)).toBe(1);
    expect(await usedCount(voucher)).toBe(0);
  });

  test('a fresh pending order is NOT expired', async () => {
    const { product } = await onlineOrder({ stock: 1 });
    const { expireStalePendingOrders } = require('../src/services/orderLifecycle.service');
    expect(await expireStalePendingOrders()).toBe(0);
    expect(await h.stockOf(product._id)).toBe(0);
  });
});

describe('prices and fees come from the server', () => {
  test('client-supplied trialFee, prices and totals are ignored', async () => {
    const product = await h.createProduct({ sizeInventory: [{ size: 'M', stock: 5 }], price: 1000 });
    const honest = await place(await h.createUser(), h.orderBody(product));
    const tampered = await place(await h.createUser(), {
      ...h.orderBody(product),
      trialFee: -5000,
      total: 1,
      items: [{ product: String(product._id), quantity: 1, selectedSize: 'M', price: 1 }]
    });
    expect(tampered.status).toBe(201);
    expect(tampered.body.order.trialFee).toBe(0);
    expect(tampered.body.order.total).toBe(honest.body.order.total);
    expect(tampered.body.order.items[0].price).toBe(1000);

    const inflated = await place(await h.createUser(), { ...h.orderBody(product), isTrial: true, trialFee: 99999, trialItems: [{ product: String(product._id), size: 'M', price: 1 }] });
    expect(inflated.status).toBe(201);
    expect(inflated.body.order.trialFee).toBe(require('../src/config/trial').TRIAL_FEE);
    expect(inflated.body.order.trialItems[0].price).toBe(1000);
  });
});

describe('voucher claims are atomic and follow the order lifecycle', () => {
  test('a once-per-user voucher: two simultaneous checkouts by the same user, only one gets it', async () => {
    const voucher = await h.createVoucher({ perUserLimit: 1, usageLimit: null });
    const product = await h.createProduct({ sizeInventory: [{ size: 'M', stock: 10 }] });
    const user = await h.createUser();
    const body = h.orderBody(product, { voucherCode: voucher.code });

    const results = await Promise.all([place(user, body), place(user, body), place(user, body)]);

    expect(count(results, 201)).toBe(1);
    expect(count(results, 400)).toBe(2);
    expect(await userUses(voucher, user)).toBe(1);
    expect(await usedCount(voucher)).toBe(1);
    expect(await Order().countDocuments()).toBe(1);
    expect(await h.stockOf(product._id)).toBe(9); // the losers reserved nothing
  });

  test('a voucher with a global limit of 1: two different users racing, only one gets it', async () => {
    const voucher = await h.createVoucher({ usageLimit: 1 });
    const product = await h.createProduct({ sizeInventory: [{ size: 'M', stock: 10 }] });
    const [a, b] = [await h.createUser(), await h.createUser()];
    const body = h.orderBody(product, { voucherCode: voucher.code });

    const results = await Promise.all([place(a, body), place(b, body)]);

    expect(count(results, 201)).toBe(1);
    expect(count(results, 400)).toBe(1);
    expect(await usedCount(voucher)).toBe(1);
  });

  test('same race through online checkout: the loser is refused BEFORE paying', async () => {
    const voucher = await h.createVoucher({ perUserLimit: 1 });
    const product = await h.createProduct({ sizeInventory: [{ size: 'M', stock: 10 }] });
    const user = await h.createUser();
    const body = h.orderBody(product, { voucherCode: voucher.code, paymentMethod: 'online' });
    const results = await Promise.all([place(user, body), place(user, body)]);
    expect(count(results, 201)).toBe(1);
    expect(count(results, 400)).toBe(1);
    expect(await Order().countDocuments()).toBe(1);
  });

  test('voucher is not consumed when the order fails for another reason (out of stock)', async () => {
    const voucher = await h.createVoucher({ usageLimit: 1 });
    const product = await h.createProduct({ sizeInventory: [{ size: 'M', stock: 0 }] });
    const user = await h.createUser();
    const res = await place(user, h.orderBody(product, { voucherCode: voucher.code }));
    expect(res.status).toBe(409);
    expect(await usedCount(voucher)).toBe(0);
    expect(await userUses(voucher, user)).toBe(0);
  });

  test('cancelling an order gives the voucher use back, once', async () => {
    const voucher = await h.createVoucher({ usageLimit: 1 });
    const product = await h.createProduct({ sizeInventory: [{ size: 'M', stock: 5 }] });
    const user = await h.createUser();
    const order = (await place(user, h.orderBody(product, { voucherCode: voucher.code }))).body.order;
    expect(order.voucherDiscount).toBe(100);
    expect(await usedCount(voucher)).toBe(1);

    const cancel = () => request(app).post(`/api/orders/${order._id}/cancel`).set(h.bearer(user));
    await Promise.all([cancel(), cancel()]);
    expect(await usedCount(voucher)).toBe(0);
    expect(await userUses(voucher, user)).toBe(0);
  });

  test('expired and inactive vouchers are refused at checkout', async () => {
    const product = await h.createProduct({ sizeInventory: [{ size: 'M', stock: 5 }] });
    const expired = await h.createVoucher({ expiryDate: new Date(Date.now() - 1000) });
    const inactive = await h.createVoucher({ isActive: false });
    const user = await h.createUser();
    expect((await place(user, h.orderBody(product, { voucherCode: expired.code }))).status).toBe(400);
    expect((await place(user, h.orderBody(product, { voucherCode: inactive.code }))).status).toBe(400);
    expect(await h.stockOf(product._id)).toBe(5);
  });

  test('the quote endpoint does not consume the voucher and keeps its response shape', async () => {
    const voucher = await h.createVoucher();
    const user = await h.createUser();
    const res = await request(app).post('/api/voucher/apply').set(h.bearer(user)).send({ code: voucher.code, cartTotal: 1000 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ code: voucher.code, discount: 100, finalPrice: 900, originalPrice: 1000 }));
    expect(await usedCount(voucher)).toBe(0);
  });
});
