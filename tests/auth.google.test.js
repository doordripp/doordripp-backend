const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { OAuth2Client } = require('google-auth-library');
const h = require('./helpers/setup');

// A locally generated key pair stands in for Google's signing keys. Only the key
// lookup is stubbed: signature, issuer, expiry and audience checks are the real
// google-auth-library + our own verification code.
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'test-key-1';
const attacker = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

const WEB_CLIENT = process.env.GOOGLE_CLIENT_ID;
const IOS_CLIENT = process.env.GOOGLE_APP_CLIENT_ID_1;
const OTHER_APPS_CLIENT = '999999999999-someoneelsesappcccccccccccccccc.apps.googleusercontent.com';

const idToken = (claims = {}, { key = privateKey, kid = KID, expiresIn = '1h' } = {}) => {
  const payload = {
    iss: 'https://accounts.google.com',
    aud: WEB_CLIENT,
    sub: '1234567890',
    email: 'buyer@example.com',
    email_verified: true,
    name: 'Buyer',
    ...claims
  };
  const options = { algorithm: 'RS256', keyid: kid };
  if (!('exp' in payload)) options.expiresIn = expiresIn;
  return jwt.sign(payload, key, options);
};

let app;
beforeAll(async () => {
  jest.spyOn(OAuth2Client.prototype, 'getFederatedSignonCertsAsync').mockResolvedValue({
    certs: { [KID]: publicKey.export({ type: 'spki', format: 'pem' }) }
  });
  await h.startDb();
  app = h.getApp();
  await h.syncIndexes();
});
afterAll(h.stopDb);
beforeEach(h.clearDb);

const signIn = (token) => request(app).post('/api/auth/google').send({ idToken: token });
const usersCount = () => require('../src/models/User').countDocuments();

describe('POST /api/auth/google - ID token verification', () => {
  test('valid token + correct audience (web client) is accepted', async () => {
    const res = await signIn(idToken());
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.user.email).toBe('buyer@example.com');
    // the issued session token works
    const me = await request(app).get('/api/auth/me').set(h.bearer(res.body.token));
    expect(me.body.authenticated).toBe(true);
  });

  test('valid token for the second configured client (iOS) is accepted', async () => {
    const res = await signIn(idToken({ aud: IOS_CLIENT }));
    expect(res.status).toBe(200);
  });

  test('valid Google token issued to a DIFFERENT app (wrong audience) is rejected', async () => {
    const res = await signIn(idToken({ aud: OTHER_APPS_CLIENT }));
    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
    expect(await usersCount()).toBe(0);
  });

  test('wrong audience cannot take over an existing account', async () => {
    const victim = await h.createUser({ email: 'buyer@example.com' });
    const res = await signIn(idToken({ aud: OTHER_APPS_CLIENT, email: victim.email }));
    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
  });

  test('token with several audiences is rejected', async () => {
    const res = await signIn(idToken({ aud: [WEB_CLIENT, OTHER_APPS_CLIENT] }));
    expect(res.status).toBe(401);
  });

  test('expired token is rejected', async () => {
    const past = Math.floor(Date.now() / 1000) - 3600;
    const res = await signIn(idToken({ iat: past - 3600, exp: past }));
    expect(res.status).toBe(401);
    expect(await usersCount()).toBe(0);
  });

  test('invalid issuer is rejected', async () => {
    const res = await signIn(idToken({ iss: 'https://evil.example.com' }));
    expect(res.status).toBe(401);
    expect(await usersCount()).toBe(0);
  });

  test('token signed by someone else is rejected', async () => {
    const res = await signIn(idToken({}, { key: attacker.privateKey }));
    expect(res.status).toBe(401);
  });

  test('unsigned (alg=none) token is rejected', async () => {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const forged = `${b64({ alg: 'none', typ: 'JWT', kid: KID })}.${b64({ iss: 'https://accounts.google.com', aud: WEB_CLIENT, sub: '1', email: 'buyer@example.com', email_verified: true, exp })}.`;
    expect((await signIn(forged)).status).toBe(401);
  });

  test.each([
    ['not-a-jwt'],
    ['a.b'],
    ['a.b.c'],
    ['']
  ])('malformed token %p is rejected', async (token) => {
    const res = await signIn(token);
    expect([400, 401]).toContain(res.status);
    expect(res.body.token).toBeUndefined();
  });

  test('non-string idToken is rejected', async () => {
    expect((await signIn({ $ne: null })).status).toBe(400);
  });

  test('unverified Google email is rejected', async () => {
    expect((await signIn(idToken({ email_verified: false }))).status).toBe(401);
  });

  test('fails closed (503) when no client ID is configured - never "accept any audience"', async () => {
    const saved = { a: process.env.GOOGLE_CLIENT_ID, b: process.env.GOOGLE_APP_CLIENT_ID_1 };
    process.env.GOOGLE_CLIENT_ID = '';
    process.env.GOOGLE_APP_CLIENT_ID_1 = '';
    try {
      const res = await signIn(idToken());
      expect(res.status).toBe(503);
      expect(res.body.token).toBeUndefined();
    } finally {
      process.env.GOOGLE_CLIENT_ID = saved.a;
      process.env.GOOGLE_APP_CLIENT_ID_1 = saved.b;
    }
  });

  test('placeholder / malformed configured IDs are ignored', () => {
    const { getAcceptedGoogleAudiences } = require('../src/utils/googleAuth');
    const saved = process.env.GOOGLE_ACCEPTED_CLIENT_IDS;
    process.env.GOOGLE_ACCEPTED_CLIENT_IDS = 'your_google_client_id.apps.googleusercontent.com, *, ';
    try {
      expect(getAcceptedGoogleAudiences()).toEqual([WEB_CLIENT, IOS_CLIENT]);
    } finally {
      process.env.GOOGLE_ACCEPTED_CLIENT_IDS = saved;
    }
  });

  test('no client ID is hardcoded in the source', () => {
    const fs = require('fs');
    const path = require('path');
    for (const file of ['src/controllers/authController.js', 'src/utils/googleAuth.js', 'src/routes/auth.js']) {
      const text = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
      expect(text).not.toMatch(/[0-9]{8,}-[a-z0-9]{20,}\.apps\.googleusercontent\.com/);
    }
  });
});
