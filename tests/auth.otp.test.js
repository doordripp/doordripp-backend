const request = require('supertest');
const h = require('./helpers/setup');

let app;
beforeAll(async () => { await h.startDb(); app = h.getApp(); await h.syncIndexes(); });
afterAll(h.stopDb);
beforeEach(h.clearDb);

const User = () => require('../src/models/User');
const Otp = () => require('../src/models/Otp');
const lastOtpFor = (email) => [...h.sent.otps].reverse().find(o => o.email === email)?.otp;
const wrongCode = (real) => (real === '000000' ? '111111' : '000000');

describe('contact verification (send-otp / verify-otp) is bound to the signed-in user', () => {
  test('anonymous callers cannot request or verify an OTP', async () => {
    const victim = await h.createUser({ emailVerified: false });
    expect((await request(app).post('/api/auth/send-otp').send({ email: victim.email })).status).toBe(401);
    expect((await request(app).post('/api/auth/verify-otp').send({ email: victim.email, code: '123456' })).status).toBe(401);
    expect(await Otp().countDocuments()).toBe(0);
    expect(h.sent.otps).toHaveLength(0);
  });

  test("a signed-in user cannot request or verify an OTP for someone else's email", async () => {
    const attacker = await h.createUser();
    const victim = await h.createUser({ emailVerified: false });

    const send = await request(app).post('/api/auth/send-otp').set(h.bearer(attacker)).send({ email: victim.email });
    expect(send.status).toBe(400);
    expect(h.sent.otps).toHaveLength(0);

    const verify = await request(app).post('/api/auth/verify-otp').set(h.bearer(attacker)).send({ email: victim.email, code: '123456' });
    expect(verify.status).toBe(400);
    expect((await User().findById(victim._id)).emailVerified).toBe(false);
  });

  test("a signed-in user cannot claim another account's phone number", async () => {
    const attacker = await h.createUser();
    const victim = await h.createUser({ phone: '9876543210', phoneVerified: false });
    const res = await request(app).post('/api/auth/send-otp').set(h.bearer(attacker)).send({ phone: '9876543210' });
    expect(res.status).toBe(400);
    expect((await User().findById(victim._id)).phoneVerified).toBe(false);
  });

  test('a user can verify their own email; the proof token is not a session token', async () => {
    const user = await h.createUser({ emailVerified: false });
    const send = await request(app).post('/api/auth/send-otp').set(h.bearer(user)).send({ email: user.email });
    expect(send.status).toBe(200);

    const res = await request(app).post('/api/auth/verify-otp').set(h.bearer(user)).send({ email: user.email, code: lastOtpFor(user.email) });
    expect(res.status).toBe(200);
    expect((await User().findById(user._id)).emailVerified).toBe(true);
    expect((await request(app).get('/api/cart').set(h.bearer(res.body.verificationToken))).status).toBe(401);
  });

  test("an OTP issued to one user cannot be redeemed from another user's session", async () => {
    const owner = await h.createUser({ emailVerified: false });
    const other = await h.createUser();
    await request(app).post('/api/auth/send-otp').set(h.bearer(owner)).send({ email: owner.email });
    const res = await request(app).post('/api/auth/verify-otp').set(h.bearer(other)).send({ email: owner.email, code: lastOtpFor(owner.email) });
    expect(res.status).toBe(400);
    expect((await User().findById(owner._id)).emailVerified).toBe(false);
  });

  test('the OTP is burned after 5 wrong guesses, even if the 6th guess is right', async () => {
    const user = await h.createUser({ emailVerified: false });
    await request(app).post('/api/auth/send-otp').set(h.bearer(user)).send({ email: user.email });
    const real = lastOtpFor(user.email);
    for (let i = 0; i < 5; i++) {
      const res = await request(app).post('/api/auth/verify-otp').set(h.bearer(user)).send({ email: user.email, code: wrongCode(real) });
      expect(res.status).toBe(400);
    }
    const res = await request(app).post('/api/auth/verify-otp').set(h.bearer(user)).send({ email: user.email, code: real });
    expect(res.status).toBe(400);
    expect((await User().findById(user._id)).emailVerified).toBe(false);
  });
});

describe('legacy email verification (resend-email-otp / verify-email-otp)', () => {
  test('cannot be used to sign in to an already verified account', async () => {
    const victim = await h.createUser({ emailVerified: true });

    const resend = await request(app).post('/api/auth/resend-email-otp').send({ email: victim.email });
    expect(resend.status).toBe(200);
    expect(h.sent.otps).toHaveLength(0); // nothing is issued for a verified account

    // even with an OTP row present (e.g. planted through another flow) no session is issued
    const { hashOTP } = require('../src/utils/otp.util');
    await Otp().create({ identifier: victim.email, type: 'email', purpose: 'verify-email', codeHash: await hashOTP('123456'), expiresAt: new Date(Date.now() + 60000) });
    const res = await request(app).post('/api/auth/verify-email-otp').send({ email: victim.email, code: '123456' });
    expect(res.status).toBe(400);
    expect(res.body.token).toBeUndefined();
  });

  test('an OTP from the contact-verification flow cannot be replayed here to obtain a session', async () => {
    const user = await h.createUser({ emailVerified: false });
    await request(app).post('/api/auth/send-otp').set(h.bearer(user)).send({ email: user.email });
    const res = await request(app).post('/api/auth/verify-email-otp').send({ email: user.email, code: lastOtpFor(user.email) });
    expect(res.status).toBe(400);
    expect(res.body.token).toBeUndefined();
  });

  test('resend does not reveal whether an account exists', async () => {
    const unverified = await h.createUser({ emailVerified: false });
    const a = await request(app).post('/api/auth/resend-email-otp').send({ email: unverified.email });
    const b = await request(app).post('/api/auth/resend-email-otp').send({ email: 'nobody@example.com' });
    expect(b.status).toBe(a.status);
    expect(b.body).toEqual(a.body);
  });

  test('works for the owner of an unverified account, and brute force is capped', async () => {
    const user = await h.createUser({ emailVerified: false });
    await request(app).post('/api/auth/resend-email-otp').send({ email: user.email });
    const real = lastOtpFor(user.email);
    for (let i = 0; i < 5; i++) {
      expect((await request(app).post('/api/auth/verify-email-otp').send({ email: user.email, code: wrongCode(real) })).status).toBe(400);
    }
    expect((await request(app).post('/api/auth/verify-email-otp').send({ email: user.email, code: real })).status).toBe(400);
    expect((await User().findById(user._id)).emailVerified).toBe(false);

    await request(app).post('/api/auth/resend-email-otp').send({ email: user.email });
    const ok = await request(app).post('/api/auth/verify-email-otp').send({ email: user.email, code: lastOtpFor(user.email) });
    expect(ok.status).toBe(200);
    expect(typeof ok.body.token).toBe('string');
  });
});

describe('registration (register-initiate / verify-email)', () => {
  const start = (email) => request(app).post('/api/auth/register-initiate')
    .send({ name: 'New Person', email, password: 'Password123!', termsAccepted: true });

  test('happy path keeps the response contract the mobile app relies on', async () => {
    const email = 'new.person@example.com';
    const init = await start(email);
    expect(init.status).toBe(200);
    expect(init.body).toEqual(expect.objectContaining({ message: expect.any(String), expiresIn: expect.any(Number) }));

    const res = await request(app).post('/api/auth/verify-email').send({ email, otp: lastOtpFor(email) });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ token: expect.any(String), user: expect.objectContaining({ email }) }));
  });

  test('no account is created before the OTP is verified, and guesses are capped at 5', async () => {
    const email = 'guess.me@example.com';
    await start(email);
    const real = lastOtpFor(email);
    for (let i = 0; i < 5; i++) {
      expect((await request(app).post('/api/auth/verify-email').send({ email, otp: wrongCode(real) })).status).toBe(400);
    }
    const res = await request(app).post('/api/auth/verify-email').send({ email, otp: real });
    expect(res.status).toBe(400);
    expect(await User().countDocuments({ email })).toBe(0);
  });

  test('cannot overwrite an existing account by re-registering its email', async () => {
    const victim = await h.createUser();
    const res = await start(victim.email);
    expect(res.status).toBe(400);
    expect(h.sent.otps).toHaveLength(0);
  });
});
