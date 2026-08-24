const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const logger = require('./logger');

const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';
const APPLE_ISSUER = 'https://appleid.apple.com';
const JWKS_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

let jwksCache = {
  keys: [],
  expiresAt: 0
};
let jwksFetchPromise = null;

/**
 * Fetch and cache Apple JWKS public keys
 * @param {boolean} forceRefresh - If true, bypass cache and fetch fresh keys
 * @returns {Promise<Array>} Array of JWK key objects
 */
async function getApplePublicKeys(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && jwksCache.keys.length > 0 && jwksCache.expiresAt > now) {
    return jwksCache.keys;
  }

  // Prevent multiple concurrent fetches
  if (jwksFetchPromise) {
    return jwksFetchPromise;
  }

  jwksFetchPromise = (async () => {
    try {
      logger.info('Fetching fresh Apple JWKS keys from Apple servers...');
      const response = await fetch(APPLE_JWKS_URL, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch Apple JWKS: HTTP ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      if (!Array.isArray(data?.keys) || data.keys.length === 0) {
        throw new Error('Apple JWKS response contains no valid keys');
      }

      jwksCache = {
        keys: data.keys,
        expiresAt: Date.now() + JWKS_CACHE_TTL_MS
      };

      logger.info(`Successfully cached ${data.keys.length} Apple public signing keys.`);
      return jwksCache.keys;
    } catch (err) {
      logger.error('Error fetching Apple JWKS:', err.message);
      // If we have stale keys, fallback to them
      if (jwksCache.keys.length > 0) {
        logger.warn('Using stale Apple JWKS keys as fallback due to network failure');
        return jwksCache.keys;
      }
      throw err;
    } finally {
      jwksFetchPromise = null;
    }
  })();

  return jwksFetchPromise;
}

/**
 * Get accepted Apple audience identifiers (Bundle IDs / Client IDs) from environment
 * @returns {Array<string>} List of accepted client IDs / bundle IDs
 */
function getAcceptedAudiences() {
  const customList = process.env.APPLE_ACCEPTED_CLIENT_IDS
    ? process.env.APPLE_ACCEPTED_CLIENT_IDS.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  const audiences = [
    process.env.APPLE_BUNDLE_ID,     // e.g. com.doordripp.app
    process.env.APPLE_CLIENT_ID,     // e.g. com.doordripp.client
    process.env.APPLE_SERVICES_ID,   // e.g. com.doordripp.service
    ...customList
  ].filter(Boolean);

  return [...new Set(audiences)];
}

/**
 * Verify Apple Identity Token (JWT) sent by Flutter / iOS app
 * @param {string} identityToken - Raw JWT string from Apple Sign-In
 * @param {object} options - Optional verification parameters
 * @returns {Promise<object>} Verified payload with user claims
 */
async function verifyAppleIdToken(identityToken, options = {}) {
  if (!identityToken || typeof identityToken !== 'string') {
    throw new Error('Apple identityToken is required');
  }

  // 1. Decode JWT header to extract key ID (kid) and algorithm (alg)
  const decodedToken = jwt.decode(identityToken, { complete: true });
  if (!decodedToken || !decodedToken.header) {
    throw new Error('Malformed Apple identity token');
  }

  const { kid, alg } = decodedToken.header;
  if (!kid) {
    throw new Error('Apple identity token header missing kid');
  }
  if (alg !== 'RS256') {
    throw new Error(`Unsupported token algorithm: ${alg}, expected RS256`);
  }

  // 2. Look up matching public key from Apple JWKS
  let keys = await getApplePublicKeys();
  let matchingJwk = keys.find(k => k.kid === kid);

  // If key not found in cache, force refresh once
  if (!matchingJwk) {
    logger.warn(`Apple key kid '${kid}' not found in cached JWKS. Refreshing JWKS...`);
    keys = await getApplePublicKeys(true);
    matchingJwk = keys.find(k => k.kid === kid);
  }

  if (!matchingJwk) {
    throw new Error(`Unable to find matching Apple public key for kid: ${kid}`);
  }

  // 3. Convert JWK to Node crypto PublicKey
  const publicKey = crypto.createPublicKey({
    format: 'jwk',
    key: {
      kty: matchingJwk.kty,
      n: matchingJwk.n,
      e: matchingJwk.e,
      alg: matchingJwk.alg || 'RS256',
      use: matchingJwk.use || 'sig'
    }
  });

  // 4. Verify signature and claims (issuer, expiration, audience)
  let verifiedPayload;
  try {
    verifiedPayload = jwt.verify(identityToken, publicKey, {
      algorithms: ['RS256'],
      issuer: APPLE_ISSUER
    });
  } catch (verifyErr) {
    if (verifyErr.name === 'TokenExpiredError') {
      throw new Error('Apple identity token has expired');
    }
    throw new Error(`Apple token signature verification failed: ${verifyErr.message}`);
  }

  // 5. Verify Audience (Bundle ID / Client ID)
  const acceptedAudiences = getAcceptedAudiences();
  const tokenAudience = verifiedPayload.aud;

  if (acceptedAudiences.length > 0) {
    const isAudienceValid = acceptedAudiences.includes(tokenAudience);
    if (!isAudienceValid) {
      logger.error(`Apple token audience mismatch. Token aud: '${tokenAudience}', Expected one of: ${acceptedAudiences.join(', ')}`);
      throw new Error('Apple token audience mismatch (invalid Bundle ID / Client ID)');
    }
  } else {
    // Development fallback notice
    logger.warn(`[Apple Auth] No APPLE_BUNDLE_ID configured in env. Token accepted with audience '${tokenAudience}'. Set APPLE_BUNDLE_ID in .env for strict validation.`);
  }

  // 6. Return structured user claims
  const email = verifiedPayload.email ? String(verifiedPayload.email).toLowerCase().trim() : null;
  const isEmailVerified = verifiedPayload.email_verified === true || verifiedPayload.email_verified === 'true';
  const isPrivateEmail = verifiedPayload.is_private_email === true || verifiedPayload.is_private_email === 'true';

  return {
    appleId: verifiedPayload.sub,
    email,
    emailVerified: isEmailVerified,
    isPrivateEmail,
    audience: tokenAudience,
    expiresAt: verifiedPayload.exp ? new Date(verifiedPayload.exp * 1000) : null,
    rawPayload: verifiedPayload
  };
}

module.exports = {
  verifyAppleIdToken,
  getApplePublicKeys,
  getAcceptedAudiences
};
