const request = require('supertest');
const h = require('./helpers/setup');

let app;
beforeAll(async () => { await h.startDb(); app = h.getApp(); await h.syncIndexes(); });
afterAll(h.stopDb);
beforeEach(h.clearDb);

const hasAnyRole = () => require('../src/middleware/auth').hasAnyRole;

describe('role checks (regression: every user passed every role check)', () => {
  test('a customer does not satisfy admin / manager / delivery_partner', () => {
    expect(hasAnyRole()([], ['admin'])).toBe(false);
    expect(hasAnyRole()([], ['admin', 'manager'])).toBe(false);
    expect(hasAnyRole()(['customer'], ['delivery_partner'])).toBe(false);
    expect(hasAnyRole()(undefined, ['admin'])).toBe(false);
  });

  test('matching roles still pass, case-insensitively', () => {
    expect(hasAnyRole()(['admin'], ['admin'])).toBe(true);
    expect(hasAnyRole()(['Manager'], ['admin', 'manager'])).toBe(true);
    expect(hasAnyRole()([], ['customer'])).toBe(true);
  });
});

describe('admin endpoints reject customers with 403', () => {
  const protectedCalls = (targetId) => [
    ['get', '/api/admin/dashboard/stats'],
    ['get', '/api/admin/users'],
    ['get', `/api/admin/users/${targetId}`],
    ['put', `/api/admin/users/${targetId}`, { name: 'Hacked' }],
    ['put', `/api/admin/users/${targetId}/role`, { roles: ['admin'] }],
    ['delete', `/api/admin/users/${targetId}`],
    ['post', `/api/admin/users/${targetId}/ban`, { reason: 'x' }],
    ['get', '/api/admin/products'],
    ['post', '/api/admin/products', { name: 'Free stuff', price: 1 }],
    ['put', `/api/admin/products/${targetId}`, { price: 1 }],
    ['delete', `/api/admin/products/${targetId}`],
    ['get', '/api/admin/orders'],
    ['put', `/api/admin/orders/${targetId}/status`, { status: 'delivered' }],
    ['get', '/api/admin/vouchers'],
    ['post', '/api/admin/vouchers', { code: 'FREE100', discountType: 'percentage', discountValue: 100 }],
    ['patch', `/api/admin/vouchers/${targetId}/toggle`],
    ['put', '/api/admin/delivery-charge-config', {}],
    ['get', '/api/admin/system-logs'],
    ['get', '/api/manager/delivery-partners'],
    ['post', '/api/manager/delivery-partners', { name: 'x' }],
    ['get', '/api/delivery/my-orders'],
    ['get', '/api/delivery-partner/orders'],
    ['get', '/api/invoices'],
    ['post', `/api/invoices/generate/${targetId}`],
    ['post', '/api/content/banners', {}],
    ['post', '/api/marketing/admin/sales', {}],
    ['get', '/api/trial-room/admin/list']
  ];

  test('every protected route answers 403 for a customer', async () => {
    const customer = await h.createUser();
    const victim = await h.createUser();
    const failures = [];
    for (const [method, url, body] of protectedCalls(victim._id)) {
      const res = await request(app)[method](url).set(h.bearer(customer)).send(body);
      if (res.status !== 403) failures.push(`${method.toUpperCase()} ${url} -> ${res.status}`);
    }
    expect(failures).toEqual([]);
  });

  test('a customer cannot promote themselves or anyone else to admin', async () => {
    const User = require('../src/models/User');
    const customer = await h.createUser();
    const res = await request(app)
      .put(`/api/admin/users/${customer._id}/role`).set(h.bearer(customer)).send({ roles: ['admin'] });
    expect(res.status).toBe(403);
    expect((await User.findById(customer._id)).roles).toEqual([]);
  });

  test('roles claimed inside a token are ignored: the database decides', async () => {
    const jwt = require('jsonwebtoken');
    const customer = await h.createUser();
    const forged = jwt.sign(
      { id: String(customer._id), roles: ['admin'], permissions: ['system_controls'], tv: 0 },
      process.env.JWT_SECRET, { expiresIn: '1h' }
    );
    const res = await request(app).get('/api/admin/users').set(h.bearer(forged));
    expect(res.status).toBe(403);
  });

  test('unauthenticated callers get 401', async () => {
    const res = await request(app).get('/api/admin/users');
    expect(res.status).toBe(401);
  });

  test('an admin is still allowed', async () => {
    const admin = await h.createUser({ roles: ['admin'] });
    const res = await request(app).get('/api/admin/users').set(h.bearer(admin));
    expect(res.status).toBe(200);
  });

  test('a manager reaches manager routes but not admin-only ones', async () => {
    const manager = await h.createUser({ roles: ['manager'] });
    const target = await h.createUser();
    expect((await request(app).get('/api/admin/users').set(h.bearer(manager))).status).toBe(200);
    const res = await request(app).put(`/api/admin/users/${target._id}/role`).set(h.bearer(manager)).send({ roles: ['admin'] });
    expect(res.status).toBe(403);
  });

  test('the ImageKit upload signature is not handed to anonymous callers', async () => {
    expect((await request(app).get('/api/imagekit-auth')).status).toBe(401);
  });
});
