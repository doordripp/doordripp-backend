/**
 * Google ID token verification for mobile / idToken sign-in.
 *
 * A token is accepted only when ALL of these hold:
 *   - the signature verifies against Google's published keys
 *   - `iss` is a Google issuer
 *   - the token is not expired
 *   - `aud` is one of the OAuth client IDs configured for THIS deployment
 *   - the email is present and verified by Google
 *
 * The accepted client IDs come exclusively from the environment. Nothing is
 * hardcoded and there is no "verify without audience" path: if no client ID is
 * configured, sign-in is refused.
 */

const { OAuth2Client } = require('google-auth-library');

const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
const CLIENT_ID_PATTERN = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/;

class GoogleAuthError extends Error {
  constructor(message, status = 401, reason = 'invalid_token') {
    super(message);
    this.name = 'GoogleAuthError';
    this.status = status;
    this.reason = reason;
  }
}

/**
 * Client IDs whose tokens this backend accepts.
 *   GOOGLE_CLIENT_ID            web client (also what Android tokens carry as `aud`
 *                               when the app passes it as serverClientId)
 *   GOOGLE_APP_CLIENT_ID_1 / _2 additional app clients (e.g. the iOS client)
 *   GOOGLE_ACCEPTED_CLIENT_IDS  optional comma-separated list
 * Placeholders and malformed values are ignored.
 */
function getAcceptedGoogleAudiences() {
  const extra = String(process.env.GOOGLE_ACCEPTED_CLIENT_IDS || '').split(',');
  const candidates = [
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_APP_CLIENT_ID_1,
    process.env.GOOGLE_APP_CLIENT_ID_2,
    ...extra
  ];
  return Array.from(new Set(
    candidates
      .map(value => String(value || '').trim())
      .filter(value => CLIENT_ID_PATTERN.test(value))
  ));
}

let sharedClient = null;
const getClient = () => {
  if (!sharedClient) sharedClient = new OAuth2Client();
  return sharedClient;
};

/**
 * @param {string} idToken
 * @param {{ client?: OAuth2Client, audiences?: string[] }} [options] injectable for tests
 * @returns {Promise<object>} the verified token payload
 */
async function verifyGoogleIdToken(idToken, options = {}) {
  if (!idToken || typeof idToken !== 'string' || idToken.split('.').length !== 3) {
    throw new GoogleAuthError('Invalid Google token', 401, 'malformed');
  }

  const audiences = options.audiences || getAcceptedGoogleAudiences();
  if (!audiences.length) {
    throw new GoogleAuthError('Google sign-in is not configured', 503, 'no_accepted_client_ids');
  }

  const client = options.client || getClient();

  let payload;
  try {
    // Verifies signature, issuer, expiry and that `aud` is in `audiences`.
    const ticket = await client.verifyIdToken({ idToken, audience: audiences });
    payload = ticket.getPayload();
  } catch (err) {
    const message = String((err && err.message) || '');
    const reason = /audience/i.test(message) ? 'audience_mismatch'
      : /late|expired/i.test(message) ? 'expired'
      : /issuer/i.test(message) ? 'invalid_issuer'
      : 'verification_failed';
    throw new GoogleAuthError('Invalid Google token', 401, reason);
  }

  if (!payload) throw new GoogleAuthError('Invalid Google token', 401, 'empty_payload');

  // Defence in depth: re-assert the claims ourselves rather than relying on the library alone.
  const tokenAudiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (tokenAudiences.length !== 1 || !audiences.includes(tokenAudiences[0])) {
    throw new GoogleAuthError('Invalid Google token', 401, 'audience_mismatch');
  }
  if (!GOOGLE_ISSUERS.includes(payload.iss)) {
    throw new GoogleAuthError('Invalid Google token', 401, 'invalid_issuer');
  }
  if (!payload.exp || payload.exp * 1000 <= Date.now()) {
    throw new GoogleAuthError('Invalid Google token', 401, 'expired');
  }
  if (!payload.sub || !payload.email) {
    throw new GoogleAuthError('Invalid Google token', 401, 'missing_identity');
  }
  if (payload.email_verified !== true && payload.email_verified !== 'true') {
    throw new GoogleAuthError('Google account email is not verified', 401, 'email_not_verified');
  }

  return payload;
}

module.exports = {
  GoogleAuthError,
  GOOGLE_ISSUERS,
  getAcceptedGoogleAudiences,
  verifyGoogleIdToken
};
