const request = require('supertest');
const h = require('./helpers/setup');

let app;
let razorpay;
beforeAll(async () => {
  await h.startDb();
  app = h.getApp();
  await h.syncIndexes();
  razorpay = require('../src/utils/razorpay');
});
afterAll(h.stopDb);
beforeEach(h.clearDb);

const Order = () => require('../src/models/Order');
const place = (user, body) => request(app).post('/api/orders').set(h.bearer(user)).send(body);
const pay = (user, order, paymentId = 'pay_refund_test') =>
  request(app).post(`/api/orders/${order._id}/verify-payment`).set(h.bearer(user)).send({
    orderId: order._id,
    razorpayPaymentId: paymentId,
    razorpaySignature: h.razorpaySignature(order.payment.razorpayOrderId, paymentId)
  });
const failedWebhook = (order) => {
  const raw = JSON.stringify({ event: 'payment.failed', payload: { payment: { entity: { id: 'pay_x', order_id: order.payment.razorpayOrderId } } } });
  return request(app).post('/webhooks/razorpay').set('Content-Type', 'application/json').set('x-razorpay-signature', h.webhookSignature(raw)).send(raw);
};
const listRefunds = (admin, query = '') => request(app).get(`/api/admin/refunds${query}`).set(h.bearer(admin));
const complete = (admin, orderId, body = { reference: 'rfnd_manual_1' }) =>
  request(app).post(`/api/admin/orders/${orderId}/refund/complete`).set(h.bearer(admin)).send(body);

async function paidOrder({ stock = 5 } = {}) {
  const product = await h.createProduct({ sizeInventory: [{ size: 'M', stock }], price: 1000 });
  const buyer = await h.createUser();
  const order = (await place(buyer, h.orderBody(product, { paymentMethod: 'online' }))).body.order;
  expect((await pay(buyer, order)).status).toBe(200);
  return { product, buyer, order };
}
const refundOf = async (orderId) => (await Order().findById(orderId)).payment;

describe('every situation that owes the customer money marks the order', () => {
  test('customer cancels a paid online order', async () => {
    const { buyer, order } = await paidOrder();
    expect((await request(app).post(`/api/orders/${order._id}/cancel`).set(h.bearer(buyer))).status).toBe(200);
    const payment = await refundOf(order._id);
    expect(payment.refundRequired).toBe(true);
    expect(payment.refundStatus).toBe('required');
    expect(payment.refundReason).toBe('order_cancelled');
    expect(payment.refundRequestedAt).toBeInstanceOf(Date);
  });

  test('admin cancels a paid order from the panel (previously not marked)', async () => {
    const { product, order } = await paidOrder({ stock: 2 });
    const admin = await h.createUser({ roles: ['admin'] });
    const res = await request(app).put(`/api/admin/orders/${order._id}/status`).set(h.bearer(admin)).send({ status: 'cancelled' });
    expect(res.status).toBe(200);
    const payment = await refundOf(order._id);
    expect(payment.refundRequired).toBe(true);
    expect(payment.refundReason).toBe('cancelled_by_staff');
    expect(await h.stockOf(product._id)).toBe(2);
  });

  test('admin marks a paid order failed, and the legacy admin status endpoint behaves the same', async () => {
    const admin = await h.createUser({ roles: ['admin'] });
    const one = await paidOrder();
    const failed = await request(app).put(`/api/admin/orders/${one.order._id}/status`).set(h.bearer(admin)).send({ status: 'failed' });
    expect(failed.status).toBe(200);
    expect((await Order().findById(one.order._id)).status).toBe('failed');
    expect((await refundOf(one.order._id)).refundRequired).toBe(true);

    const two = await paidOrder();
    const res = await request(app).patch(`/api/orders/${two.order._id}/status`).set(h.bearer(admin)).send({ status: 'cancelled' });
    expect(res.status).toBe(200);
    expect((await refundOf(two.order._id)).refundRequired).toBe(true);
  });

  test('payment received after the item sold out', async () => {
    const product = await h.createProduct({ sizeInventory: [{ size: 'M', stock: 1 }] });
    const buyer = await h.createUser();
    const order = (await place(buyer, h.orderBody(product, { paymentMethod: 'online' }))).body.order;
    await failedWebhook(order);
    await place(await h.createUser(), h.orderBody(product));
    expect((await pay(buyer, order)).status).toBe(409);
    const payment = await refundOf(order._id);
    expect(payment.refundRequired).toBe(true);
    expect(payment.refundReason).toBe('paid_but_out_of_stock');
  });

  test('payment received after the customer cancelled', async () => {
    const product = await h.createProduct({ sizeInventory: [{ size: 'M', stock: 3 }] });
    const buyer = await h.createUser();
    const order = (await place(buyer, h.orderBody(product, { paymentMethod: 'online' }))).body.order;
    await request(app).post(`/api/orders/${order._id}/cancel`).set(h.bearer(buyer));
    expect((await refundOf(order._id)).refundRequired).toBe(false); // nothing paid yet
    await pay(buyer, order);
    const payment = await refundOf(order._id);
    expect(payment.refundRequired).toBe(true);
    expect(payment.refundReason).toBe('paid_after_cancellation');
    expect((await Order().findById(order._id)).status).toBe('cancelled');
  });
});

describe('orders that are NOT owed a refund are not marked', () => {
  test('COD order cancelled by customer or by admin', async () => {
    const product = await h.createProduct({ sizeInventory: [{ size: 'M', stock: 5 }] });
    const buyer = await h.createUser();
    const admin = await h.createUser({ roles: ['admin'] });
    const a = (await place(buyer, h.orderBody(product))).body.order;
    const b = (await place(buyer, h.orderBody(product))).body.order;
    await request(app).post(`/api/orders/${a._id}/cancel`).set(h.bearer(buyer));
    await request(app).put(`/api/admin/orders/${b._id}/status`).set(h.bearer(admin)).send({ status: 'cancelled' });
    for (const id of [a._id, b._id]) {
      const payment = await refundOf(id);
      expect(payment.refundRequired).toBe(false);
      expect(payment.refundStatus).toBe('none');
    }
  });

  test('unpaid online order that is cancelled, failed or abandoned', async () => {
    const product = await h.createProduct({ sizeInventory: [{ size: 'M', stock: 5 }] });
    const buyer = await h.createUser();
    const admin = await h.createUser({ roles: ['admin'] });
    const a = (await place(buyer, h.orderBody(product, { paymentMethod: 'online' }))).body.order;
    const b = (await place(buyer, h.orderBody(product, { paymentMethod: 'online' }))).body.order;
    await failedWebhook(a);
    await request(app).put(`/api/admin/orders/${b._id}/status`).set(h.bearer(admin)).send({ status: 'cancelled' });
    expect((await refundOf(a._id)).refundRequired).toBe(false);
    expect((await refundOf(b._id)).refundRequired).toBe(false);
    expect((await listRefunds(admin)).body.refunds).toEqual([]);
  });

  test('a normally confirmed paid order', async () => {
    const { order } = await paidOrder();
    expect((await refundOf(order._id)).refundStatus).toBe('none');
  });
});

describe('admin refund list and manual completion', () => {
  test('lists refunds owed with what staff need to issue them by hand', async () => {
    const { buyer, order } = await paidOrder();
    await paidOrder(); // paid, not cancelled: must not appear
    await request(app).post(`/api/orders/${order._id}/cancel`).set(h.bearer(buyer));
    const admin = await h.createUser({ roles: ['admin'] });

    const res = await listRefunds(admin);
    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBe(1);
    expect(res.body.refunds[0]).toEqual(expect.objectContaining({
      orderId: String(order._id),
      amount: order.total, // the full amount paid, delivery fee included
      razorpayPaymentId: 'pay_refund_test',
      razorpayOrderId: order.payment.razorpayOrderId,
      refundStatus: 'required',
      reason: 'order_cancelled',
      customer: expect.objectContaining({ email: buyer.email })
    }));
  });

  test('completing a refund records who/when/reference and removes it from the owed list', async () => {
    const { buyer, order } = await paidOrder();
    await request(app).post(`/api/orders/${order._id}/cancel`).set(h.bearer(buyer));
    const admin = await h.createUser({ roles: ['admin'] });

    const res = await complete(admin, order._id, { reference: 'rfnd_ABC123', note: 'Refunded in dashboard' });
    expect(res.status).toBe(200);
    expect(res.body.refund).toEqual(expect.objectContaining({ refundStatus: 'completed', refundReference: 'rfnd_ABC123' }));

    const payment = await refundOf(order._id);
    expect(payment.refundRequired).toBe(false);
    expect(payment.refundStatus).toBe('completed');
    expect(String(payment.refundedBy)).toBe(String(admin._id));
    expect(payment.refundedAt).toBeInstanceOf(Date);
    expect(payment.status).toBe('success'); // the payment record itself is not rewritten

    expect((await listRefunds(admin)).body.refunds).toEqual([]);
    const done = await listRefunds(admin, '?status=completed');
    expect(done.body.refunds).toHaveLength(1);
  });

  test('a refund can be recorded only once, even with simultaneous clicks', async () => {
    const { buyer, order } = await paidOrder();
    await request(app).post(`/api/orders/${order._id}/cancel`).set(h.bearer(buyer));
    const admin = await h.createUser({ roles: ['admin'] });

    const results = await Promise.all([
      complete(admin, order._id, { reference: 'rfnd_A' }),
      complete(admin, order._id, { reference: 'rfnd_B' }),
      complete(admin, order._id, { reference: 'rfnd_C' })
    ]);
    expect(results.filter(r => r.status === 200)).toHaveLength(1);
    expect(results.filter(r => r.status === 409)).toHaveLength(2);
    expect((await complete(admin, order._id)).status).toBe(409);

    // a completed refund is never put back on the owed list by a later status change
    await request(app).put(`/api/admin/orders/${order._id}/status`).set(h.bearer(admin)).send({ status: 'failed' });
    expect((await refundOf(order._id)).refundStatus).toBe('completed');
    expect((await listRefunds(admin)).body.refunds).toEqual([]);
  });

  test('validation: reference required; orders not awaiting a refund are refused', async () => {
    const admin = await h.createUser({ roles: ['admin'] });
    const { buyer, order } = await paidOrder();
    expect((await complete(admin, order._id)).status).toBe(409); // paid and fine: nothing owed
    await request(app).post(`/api/orders/${order._id}/cancel`).set(h.bearer(buyer));
    expect((await complete(admin, order._id, {})).status).toBe(400);
    expect((await complete(admin, order._id, { reference: { $ne: null } })).status).toBe(400);
    expect((await complete(admin, '000000000000000000000000')).status).toBe(404);
    expect((await complete(admin, 'not-an-id')).status).toBe(404);
    expect((await refundOf(order._id)).refundRequired).toBe(true);
  });

  test('customers, managers and anonymous callers cannot reach refund management', async () => {
    const { buyer, order } = await paidOrder();
    await request(app).post(`/api/orders/${order._id}/cancel`).set(h.bearer(buyer));
    const manager = await h.createUser({ roles: ['manager'] });

    for (const user of [buyer, await h.createUser(), manager]) {
      expect((await listRefunds(user)).status).toBe(403);
      expect((await complete(user, order._id)).status).toBe(403);
    }
    expect((await request(app).get('/api/admin/refunds')).status).toBe(401);
    expect((await request(app).post(`/api/admin/orders/${order._id}/refund/complete`).send({ reference: 'x' })).status).toBe(401);
    expect((await refundOf(order._id)).refundRequired).toBe(true);
  });

  test('a customer cannot mark their own order as refund-required or refunded through order APIs', async () => {
    const { buyer, order } = await paidOrder();
    const res = await request(app).patch(`/api/orders/${order._id}/status`).set(h.bearer(buyer)).send({ status: 'cancelled' });
    expect(res.status).toBe(403);
    expect((await refundOf(order._id)).refundStatus).toBe('none');
  });
});

describe('refunds stay manual', () => {
  test('the backend never calls a Razorpay refund API', async () => {
    const { buyer, order } = await paidOrder();
    const spies = [];
    if (razorpay.instance) {
      spies.push(jest.spyOn(razorpay.instance.payments, 'refund').mockResolvedValue({}));
    }
    await request(app).post(`/api/orders/${order._id}/cancel`).set(h.bearer(buyer));
    const admin = await h.createUser({ roles: ['admin'] });
    await complete(admin, order._id);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();

    const fs = require('fs');
    const path = require('path');
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true })
      .flatMap(e => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
    const offenders = walk(path.join(__dirname, '..', 'src'))
      .filter(f => f.endsWith('.js'))
      .filter(f => /payments\.refund\s*\(|refunds\.(create|edit)\s*\(|\/refunds?['"`]\s*,\s*\{[^}]*method:\s*['"]POST/.test(fs.readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
