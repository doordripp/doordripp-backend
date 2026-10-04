const mongoose = require('mongoose');
const request = require('supertest');
const h = require('./helpers/setup');

let app;
beforeAll(async () => { await h.startDb(); app = h.getApp(); await h.syncIndexes(); });
afterAll(h.stopDb);
beforeEach(h.clearDb);

const M = (name) => require(`../src/models/${name}`);
const del = (token, method = 'delete', path = '/api/auth/delete-account') => request(app)[method](path).set(h.bearer(token));

async function seedPersonalData(user, product) {
  await M('Cart').create({ user: user._id, items: [{ product: product._id, quantity: 1 }] });
  await M('Wishlist').create({ user: user._id, items: [] }).catch(() => M('Wishlist').collection.insertOne({ user: user._id }));
  await M('Address').collection.insertOne({ userId: user._id, name: 'Home', phone: '9876543210', line1: '1 Secret Lane' });
  await M('Otp').create({ identifier: user.email, type: 'email', codeHash: 'x', expiresAt: new Date(Date.now() + 60000) });
  await M('Notification').collection.insertOne({ recipient: user._id, title: 'hi', message: 'hi' });
  await M('SupportTicket').create({ name: user.name, email: user.email, message: 'my address is ...', userId: user._id });
  await M('Newsletter').create({ email: user.email });
  await M('Review').collection.insertOne({ product: product._id, user: user._id, rating: 5, comment: 'Nice' });
}

describe('DELETE /api/auth/delete-account', () => {
  test('requires authentication', async () => {
    expect((await request(app).delete('/api/auth/delete-account')).status).toBe(401);
    expect((await del('garbage')).status).toBe(401);
  });

  test('removes personal data, anonymises the account, keeps order records', async () => {
    const product = await h.createProduct({ sizeInventory: [{ size: 'M', stock: 5 }] });
    const user = await h.createUser({ phone: '9876543210', googleId: 'g-123', avatar: 'https://lh3.googleusercontent.com/a/x', address: { street: '1 Secret Lane', city: 'Pune' } });
    const other = await h.createUser();
    await seedPersonalData(user, product);
    await seedPersonalData(other, product);
    const token = (await request(app).post('/api/auth/login').send({ email: user.email, password: 'Password123!' })).body.token;
    const orderRes = await request(app).post('/api/orders').set(h.bearer(token)).send(h.orderBody(product));
    expect(orderRes.status).toBe(201);
    const originalEmail = user.email;

    const res = await del(token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'Account deleted successfully' });

    // deleted
    for (const [model, filter] of [
      ['Cart', { user: user._id }], ['Wishlist', { user: user._id }], ['Address', { userId: user._id }],
      ['Otp', { identifier: originalEmail }], ['Notification', { recipient: user._id }],
      ['SupportTicket', { email: originalEmail }], ['Newsletter', { email: originalEmail }]
    ]) {
      expect([model, await M(model).countDocuments(filter)]).toEqual([model, 0]);
    }

    // anonymised tombstone: no personal field survives
    const tomb = await M('User').findById(user._id).lean();
    expect(tomb.isDeleted).toBe(true);
    expect(tomb.name).toBe('Deleted User');
    expect(tomb.email).not.toBe(originalEmail);
    expect(JSON.stringify(tomb)).not.toContain(originalEmail);
    for (const field of ['phone', 'googleId', 'appleId', 'address']) expect(tomb[field]).toBeUndefined();
    expect(tomb.avatar).toBeNull();
    expect(tomb.roles).toEqual([]);

    // retained: the order (legal/accounting record) still exists and still resolves its customer
    const order = await M('Order').findById(orderRes.body.order._id).populate('customer');
    expect(order).not.toBeNull();
    expect(order.customer.name).toBe('Deleted User');
    expect(await M('Review').countDocuments({ user: user._id })).toBe(1);

    // other users are untouched
    expect(await M('Cart').countDocuments({ user: other._id })).toBe(1);
    expect((await M('User').findById(other._id)).email).toBe(other.email);

    // the account is unusable
    expect((await request(app).get('/api/cart').set(h.bearer(token))).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set(h.bearer(token))).body.authenticated).toBe(false);
    expect((await request(app).post('/api/auth/login').send({ email: originalEmail, password: 'Password123!' })).status).toBe(401);
    expect((await request(app).post('/api/auth/forgot-password').send({ email: originalEmail })).status).toBe(200);
  });

  test('is idempotent: retrying with the same credential answers 200 again', async () => {
    const user = await h.createUser();
    const token = h.tokenFor(user);
    expect((await del(token)).status).toBe(200);
    const retry = await del(token);
    expect(retry.status).toBe(200);
    expect(retry.body.success).toBe(true);
    expect(await M('User').countDocuments({ _id: user._id, isDeleted: true })).toBe(1);
  });

  test('concurrent delete requests leave one consistent tombstone', async () => {
    const user = await h.createUser();
    const token = h.tokenFor(user);
    const results = await Promise.all([del(token), del(token), del(token)]);
    expect(results.every(r => r.status === 200)).toBe(true);
    const tomb = await M('User').findById(user._id).lean();
    expect(tomb.isDeleted).toBe(true);
    expect(tomb.tokenVersion).toBe(1);
  });

  test('is transactional: a failure part-way leaves the account fully intact', async () => {
    const product = await h.createProduct();
    const user = await h.createUser();
    await seedPersonalData(user, product);
    const token = h.tokenFor(user);

    const spy = jest.spyOn(M('Newsletter'), 'deleteMany').mockImplementationOnce(() => { throw new Error('simulated storage failure'); });
    const res = await del(token);
    spy.mockRestore();

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to delete account');
    const still = await M('User').findById(user._id);
    expect(still.isDeleted).toBe(false);
    expect(still.email).toBe(user.email);
    expect(await M('Cart').countDocuments({ user: user._id })).toBe(1); // rolled back
    expect(await M('Address').countDocuments({ userId: user._id })).toBe(1);

    // and the retry completes
    expect((await del(token)).status).toBe(200);
    expect(await M('Cart').countDocuments({ user: user._id })).toBe(0);
  });

  test('the email can be registered again afterwards as a brand-new account', async () => {
    const user = await h.createUser({ phone: '9876543210' });
    const email = user.email;
    await del(h.tokenFor(user));
    const fresh = await h.createUser({ email, phone: '9876543210' });
    expect(String(fresh._id)).not.toBe(String(user._id));
  });

  test('the alternate routes the web client uses behave the same', async () => {
    const a = await h.createUser();
    const b = await h.createUser();
    expect((await del(h.tokenFor(a), 'delete', '/api/auth/account')).status).toBe(200);
    expect((await del(h.tokenFor(b), 'post', '/api/auth/delete-account')).status).toBe(200);
  });

  test("a user can only delete their own account; admin deletion uses the same anonymisation", async () => {
    const admin = await h.createUser({ roles: ['admin'] });
    const customer = await h.createUser();
    const victim = await h.createUser();

    expect((await request(app).delete(`/api/admin/users/${victim._id}`).set(h.bearer(customer))).status).toBe(403);
    expect((await M('User').findById(victim._id)).isDeleted).toBe(false);

    expect((await request(app).delete(`/api/admin/users/${victim._id}`).set(h.bearer(admin))).status).toBe(200);
    expect((await M('User').findById(victim._id)).isDeleted).toBe(true);
    expect((await request(app).delete(`/api/admin/users/${new mongoose.Types.ObjectId()}`).set(h.bearer(admin))).status).toBe(404);
  });
});
