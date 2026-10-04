const request = require('supertest');
const h = require('./helpers/setup');

let app;
beforeAll(async () => {
  // Rate limiting is switched off for the other suites; this one exercises it.
  process.env.DISABLE_RATE_LIMIT = 'false';
  await h.startDb();
  app = h.getApp();
  await h.syncIndexes();
});
afterAll(h.stopDb);

const login = (email, password, ip) => {
  const req = request(app).post('/api/auth/login');
  return req.send({ email, password });
};

describe('rate limiting on authentication endpoints', () => {
  test('login: repeated wrong passwords for one account are cut off with 429', async () => {
    const user = await h.createUser();
    const statuses = [];
    for (let i = 0; i < 12; i++) statuses.push((await login(user.email, 'wrong-password')).status);
    expect(statuses.slice(0, 10).every(s => s === 401)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);

    // the correct password is refused too while locked - the lock is on the account, not the guess
    const res = await login(user.email, 'Password123!');
    expect(res.status).toBe(429);
    expect(res.body.token).toBeUndefined();
    expect(res.headers['ratelimit-limit'] || res.headers['ratelimit']).toBeDefined();
  });

  test('login: the 429 is the same for an account that does not exist', async () => {
    let last;
    for (let i = 0; i < 12; i++) last = await login('ghost@example.com', 'wrong-password');
    expect(last.status).toBe(429);
    expect(last.body).toEqual({ error: 'Too many attempts. Please try again later.' });
  });

  test('login: a normal user who logs in successfully many times is never blocked', async () => {
    const user = await h.createUser();
    for (let i = 0; i < 15; i++) {
      expect((await login(user.email, 'Password123!')).status).toBe(200);
    }
  });

  test('OTP send: an inbox cannot be flooded (registration resend)', async () => {
    const email = 'flood.target@example.com';
    const statuses = [];
    for (let i = 0; i < 7; i++) {
      const res = await request(app).post('/api/auth/register-initiate')
        .send({ name: 'Some One', email, password: 'Password123!', termsAccepted: true });
      statuses.push(res.status);
    }
    expect(statuses.filter(s => s === 200)).toHaveLength(5);
    expect(statuses.slice(5)).toEqual([429, 429]);
    expect(h.sent.otps.filter(o => o.email === email)).toHaveLength(5);
  });

  test('OTP verify: guessing is throttled per target account', async () => {
    const email = 'otp.guess@example.com';
    const statuses = [];
    for (let i = 0; i < 12; i++) {
      statuses.push((await request(app).post('/api/auth/verify-email').send({ email, otp: '000000' })).status);
    }
    expect(statuses.slice(0, 10).every(s => s === 400)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });

  test('forgot-password: one address cannot be spammed with reset mails', async () => {
    const user = await h.createUser();
    const statuses = [];
    for (let i = 0; i < 5; i++) {
      statuses.push((await request(app).post('/api/auth/forgot-password').send({ email: user.email })).status);
    }
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
  });

  test('the disable switch is ignored in production', async () => {
    const saved = { env: process.env.NODE_ENV, off: process.env.DISABLE_RATE_LIMIT };
    let loginLimiters;
    jest.isolateModules(() => { ({ loginLimiters } = require('../src/middleware/rateLimiters')); });
    const express = require('express');
    const probe = express();
    probe.use(express.json());
    probe.post('/x', loginLimiters, (req, res) => res.status(401).json({}));
    process.env.NODE_ENV = 'production';
    process.env.DISABLE_RATE_LIMIT = 'true';
    try {
      let last;
      for (let i = 0; i < 12; i++) last = await request(probe).post('/x').send({ email: 'a@b.c' });
      expect(last.status).toBe(429);
    } finally {
      process.env.NODE_ENV = saved.env;
      process.env.DISABLE_RATE_LIMIT = saved.off;
    }
  });
});
