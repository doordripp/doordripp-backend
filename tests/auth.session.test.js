const jwt = require('jsonwebtoken');
const request = require('supertest');
const h = require('./helpers/setup');

let app;
beforeAll(async () => { await h.startDb(); app = h.getApp(); await h.syncIndexes(); });
afterAll(h.stopDb);
beforeEach(h.clearDb);

const login = (email, password = 'Password123!') => request(app).post('/api/auth/login').send({ email, password });
const cart = (token) => request(app).get('/api/cart').set(h.bearer(token));

describe('JWT secret configuration', () => {
  const authConfig = () => require('../src/config/auth');

  test('there is no fallback: a missing secret throws instead of signing with a default', () => {
    const saved = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    try {
      expect(() => authConfig().getJwtSecret()).toThrow(/JWT_SECRET/);
      expect(() => authConfig().signAuthToken({ _id: 'x', roles: [] })).toThrow();
    } finally {
      process.env.JWT_SECRET = saved;
    }
  });

  test('a token signed with the old hardcoded default "secret" is rejected', async () => {
    const user = await h.createUser();
    const forged = jwt.sign({ id: String(user._id), roles: ['admin'] }, 'secret', { expiresIn: '7d' });
    expect((await cart(forged)).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set(h.bearer(forged))).body.authenticated).toBe(false);
    expect((await request(app).post('/api/auth/refresh').set(h.bearer(forged))).status).toBe(401);
  });

  test('production refuses weak / default secrets; development still works with a short one', () => {
    const saved = { secret: process.env.JWT_SECRET, env: process.env.NODE_ENV };
    try {
      process.env.NODE_ENV = 'production';
      for (const weak of ['secret', 'changeme', 'short', 'CHANGE-THIS-IN-PRODUCTION-CHANGE-THIS-IN-PRODUCTION']) {
        process.env.JWT_SECRET = weak;
        expect(() => authConfig().getJwtSecret()).toThrow(/weak/);
      }
      process.env.NODE_ENV = 'development';
      process.env.JWT_SECRET = 'short-dev-secret';
      expect(authConfig().getJwtSecret()).toBe('short-dev-secret');
    } finally {
      process.env.JWT_SECRET = saved.secret;
      process.env.NODE_ENV = saved.env;
    }
  });

  test('startup validation fails clearly when the secret is missing or weak in production', () => {
    const validateEnv = require('../src/config/validateEnv');
    const saved = { ...process.env };
    try {
      Object.assign(process.env, {
        MONGO_URI: 'mongodb://localhost/x', IMAGEKIT_PUBLIC_KEY: 'a', IMAGEKIT_PRIVATE_KEY: 'b', IMAGEKIT_URL_ENDPOINT: 'c',
        NODE_ENV: 'production'
      });
      delete process.env.JWT_SECRET;
      expect(() => validateEnv()).toThrow(/JWT_SECRET/);
      process.env.JWT_SECRET = 'secret';
      expect(() => validateEnv()).toThrow(/JWT_SECRET/);
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
    }
  });

  test('no source file references a JWT secret fallback', () => {
    const { scan } = require('../scripts/check-secrets');
    expect(scan().filter(f => f.rule === 'JWT secret fallback')).toEqual([]);
  });

  test('expired tokens are rejected', async () => {
    const user = await h.createUser();
    const expired = jwt.sign({ id: String(user._id), roles: [], tv: 0 }, process.env.JWT_SECRET, { expiresIn: -10 });
    expect((await cart(expired)).status).toBe(401);
  });

  test('tokens issued before this change (no tv / jti claims) keep working', async () => {
    const user = await h.createUser();
    const legacy = jwt.sign({ id: user._id, roles: [] }, process.env.JWT_SECRET, { expiresIn: '7d' });
    expect((await cart(legacy)).status).toBe(200);
  });
});

describe('session lifecycle and revocation', () => {
  test('login -> authenticated request -> logout -> old token rejected -> re-login works', async () => {
    const user = await h.createUser();

    const first = await login(user.email);
    expect(first.status).toBe(200);
    const token = first.body.token;
    expect(first.body.user.email).toBe(user.email);

    expect((await cart(token)).status).toBe(200);
    expect((await request(app).get('/api/auth/me').set(h.bearer(token))).body.authenticated).toBe(true);

    const out = await request(app).post('/api/auth/logout').set(h.bearer(token));
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ ok: true });

    // the previously issued credential is dead on the server, not just forgotten by the client
    expect((await cart(token)).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set(h.bearer(token))).body).toEqual({ authenticated: false });
    expect((await request(app).post('/api/auth/refresh').set(h.bearer(token))).status).toBe(401);

    const second = await login(user.email);
    expect(second.status).toBe(200);
    expect(second.body.token).not.toBe(token);
    expect((await cart(second.body.token)).status).toBe(200);
  });

  test('logging out one device does not log out another', async () => {
    const user = await h.createUser();
    const a = (await login(user.email)).body.token;
    const b = (await login(user.email)).body.token;
    await request(app).post('/api/auth/logout').set(h.bearer(a));
    expect((await cart(a)).status).toBe(401);
    expect((await cart(b)).status).toBe(200);
  });

  test('logout is idempotent and never errors without / with a bad token', async () => {
    const user = await h.createUser();
    const token = (await login(user.email)).body.token;
    expect((await request(app).post('/api/auth/logout').set(h.bearer(token))).status).toBe(200);
    expect((await request(app).post('/api/auth/logout').set(h.bearer(token))).status).toBe(200);
    expect((await request(app).post('/api/auth/logout')).status).toBe(200);
    expect((await request(app).post('/api/auth/logout').set(h.bearer('garbage'))).status).toBe(200);
  });

  test('the cookie session (web) is revoked by logout too', async () => {
    const user = await h.createUser();
    const res = await login(user.email);
    const cookie = res.headers['set-cookie'][0].split(';')[0];
    expect((await request(app).get('/api/cart').set('Cookie', cookie)).status).toBe(200);
    await request(app).post('/api/auth/logout').set('Cookie', cookie);
    expect((await request(app).get('/api/cart').set('Cookie', cookie)).status).toBe(401);
  });

  test('changing the password revokes every other session; the session that made the change survives', async () => {
    const user = await h.createUser();
    const stolen = (await login(user.email)).body.token;
    const mine = (await login(user.email)).body.token;

    const res = await request(app).put('/api/auth/change-password').set(h.bearer(mine))
      .send({ currentPassword: 'Password123!', newPassword: 'NewPassword456!' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    expect((await cart(stolen)).status).toBe(401);
    expect((await cart(mine)).status).toBe(200); // the mobile app keeps using this token
    expect((await cart(res.body.token)).status).toBe(200);

    // ...until it logs out, or the password is reset
    await request(app).post('/api/auth/logout').set(h.bearer(mine));
    expect((await cart(mine)).status).toBe(401);
    expect((await login(user.email, 'NewPassword456!')).status).toBe(200);
  });

  test('banning a user ends their sessions immediately', async () => {
    const admin = await h.createUser({ roles: ['admin'] });
    const user = await h.createUser();
    const token = (await login(user.email)).body.token;
    const ban = await request(app).post(`/api/admin/users/${user._id}/ban`).set(h.bearer(admin)).send({ reason: 'fraud' });
    expect(ban.status).toBe(200);
    expect((await cart(token)).status).toBe(401);
    expect((await login(user.email)).status).toBe(403);
  });

  test('a password-reset token cannot be used as a session token', async () => {
    const user = await h.createUser();
    const { signPurposeToken } = require('../src/config/auth');
    const reset = signPurposeToken({ id: String(user._id) }, 'password-reset', '1h');
    expect((await cart(reset)).status).toBe(401);
  });

  test('password reset: single use, revokes existing sessions', async () => {
    const User = require('../src/models/User');
    const mail = require('../src/services/mail.service');
    const user = await h.createUser();
    const session = (await login(user.email)).body.token;

    expect((await request(app).post('/api/auth/forgot-password').send({ email: user.email })).status).toBe(200);
    const resetToken = mail.sendPasswordResetEmail.mock.calls.pop()[1];

    const done = await request(app).post('/api/auth/reset-password').send({ token: resetToken, newPassword: 'ResetPass789!' });
    expect(done.status).toBe(200);
    expect((await cart(session)).status).toBe(401);
    expect((await login(user.email, 'ResetPass789!')).status).toBe(200);

    const again = await request(app).post('/api/auth/reset-password').send({ token: resetToken, newPassword: 'Another000!' });
    expect(again.status).toBe(400);
    expect((await User.findById(user._id)).resetPasswordToken).toBeFalsy();
  });

  test('forgot-password answers identically for unknown and known emails', async () => {
    const user = await h.createUser();
    const known = await request(app).post('/api/auth/forgot-password').send({ email: user.email });
    const unknown = await request(app).post('/api/auth/forgot-password').send({ email: 'nobody@example.com' });
    expect(unknown.status).toBe(known.status);
    expect(unknown.body).toEqual(known.body);
  });

  test('login does not accept operator objects (NoSQL injection)', async () => {
    await h.createUser();
    const res = await request(app).post('/api/auth/login').send({ email: { $ne: null }, password: { $ne: null } });
    expect([400, 401]).toContain(res.status);
    expect(res.body.token).toBeUndefined();
  });
});
