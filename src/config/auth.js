/**
 * Centralized JWT configuration.
 *
 * Every place that signs or verifies a token must go through this module so
 * there is exactly one source for the secret and no fallback value anywhere.
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const AUTH_TOKEN_TTL = '7d';
const AUTH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const JWT_ALGORITHM = 'HS256';
const MIN_SECRET_LENGTH = 32;

const KNOWN_WEAK_SECRETS = new Set(['secret', 'changeme', 'jwt_secret', 'your_jwt_secret']);

function isWeakJwtSecret(secret) {
  if (!secret || typeof secret !== 'string' || !secret.trim()) return true;
  const normalized = secret.trim();
  if (KNOWN_WEAK_SECRETS.has(normalized.toLowerCase())) return true;
  if (normalized.includes('CHANGE-THIS-IN-PRODUCTION')) return true;
  return normalized.length < MIN_SECRET_LENGTH;
}

/**
 * Returns the configured secret or throws. Never returns a default.
 * In production a weak/placeholder secret is rejected as well.
 */
function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || !secret.trim()) {
    const err = new Error('JWT_SECRET is not configured');
    err.code = 'JWT_SECRET_MISSING';
    throw err;
  }
  if (process.env.NODE_ENV === 'production' && isWeakJwtSecret(secret)) {
    const err = new Error('JWT_SECRET is too weak for production');
    err.code = 'JWT_SECRET_WEAK';
    throw err;
  }
  return secret;
}

/** Sign a session token for a user. `tv` ties the token to the user's token version. */
function signAuthToken(user) {
  const payload = {
    id: String(user._id),
    roles: user.roles || [],
    tv: user.tokenVersion || 0,
    jti: crypto.randomUUID()
  };
  return jwt.sign(payload, getJwtSecret(), { expiresIn: AUTH_TOKEN_TTL, algorithm: JWT_ALGORITHM });
}

/** Sign a short-lived, single-purpose token (password reset, invoice download, ...). */
function signPurposeToken(payload, purpose, expiresIn) {
  return jwt.sign({ ...payload, purpose }, getJwtSecret(), { expiresIn, algorithm: JWT_ALGORITHM });
}

/** Verify signature + expiry. Throws on any failure. */
function verifyToken(token) {
  return jwt.verify(token, getJwtSecret(), { algorithms: [JWT_ALGORITHM] });
}

/** Verify a purpose token and make sure it was issued for exactly this purpose. */
function verifyPurposeToken(token, purpose) {
  const payload = verifyToken(token);
  if (!payload || payload.purpose !== purpose) {
    throw new Error('Invalid token purpose');
  }
  return payload;
}

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

module.exports = {
  AUTH_TOKEN_TTL_MS,
  MIN_SECRET_LENGTH,
  isWeakJwtSecret,
  getJwtSecret,
  signAuthToken,
  signPurposeToken,
  verifyToken,
  verifyPurposeToken,
  hashToken
};
