/**
 * Rate limiters for authentication-sensitive endpoints.
 *
 * Two dimensions are limited independently:
 *   - per client IP      (stops one host hammering many accounts)
 *   - per target account (stops many hosts hammering one account / inbox)
 *
 * Limits are sized so a real person mistyping a password or an OTP a few times
 * is never blocked. Exceeding a limit returns HTTP 429 with a generic message
 * that does not reveal whether the account exists.
 *
 * NOTE: counters live in process memory. With several Cloud Run instances each
 * instance counts separately, so the effective ceiling is (limit x instances).
 * The per-OTP attempt caps stored in MongoDB are the hard brute-force bound.
 */

const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

// The switch exists for local development only and is ignored in production.
const isDisabled = () =>
  process.env.DISABLE_RATE_LIMIT === 'true' && process.env.NODE_ENV !== 'production';

const MINUTE = 60 * 1000;

const normalizeIdentifier = (value) => String(value || '').trim().toLowerCase().slice(0, 254);

const ipKey = (req) => ipKeyGenerator(req.ip || '');

const identifierKey = (fields) => (req) => {
  for (const field of fields) {
    const value = req.body && req.body[field];
    if (typeof value === 'string' && value.trim()) return `id:${normalizeIdentifier(value)}`;
  }
  return `ip:${ipKey(req)}`;
};

const build = ({ windowMs, max, keyGenerator, message, skipSuccessfulRequests = false }) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests,
    keyGenerator,
    skip: isDisabled,
    handler: (req, res) => res.status(429).json({ error: message })
  });

const TOO_MANY_ATTEMPTS = 'Too many attempts. Please try again later.';
const TOO_MANY_OTP = 'Too many OTP requests. Please try again later.';

// Login: only failed attempts count, so a legitimate user is not penalised for logging in often.
const loginIpLimiter = build({ windowMs: 15 * MINUTE, max: 30, keyGenerator: ipKey, message: TOO_MANY_ATTEMPTS, skipSuccessfulRequests: true });
const loginAccountLimiter = build({ windowMs: 15 * MINUTE, max: 10, keyGenerator: identifierKey(['email']), message: TOO_MANY_ATTEMPTS, skipSuccessfulRequests: true });

// Anything that sends an email / SMS.
const otpSendIpLimiter = build({ windowMs: 60 * MINUTE, max: 20, keyGenerator: ipKey, message: TOO_MANY_OTP });
const otpSendAccountLimiter = build({ windowMs: 60 * MINUTE, max: 5, keyGenerator: identifierKey(['email', 'phone']), message: TOO_MANY_OTP });

// OTP / code verification.
const otpVerifyIpLimiter = build({ windowMs: 15 * MINUTE, max: 30, keyGenerator: ipKey, message: TOO_MANY_ATTEMPTS, skipSuccessfulRequests: true });
const otpVerifyAccountLimiter = build({ windowMs: 15 * MINUTE, max: 10, keyGenerator: identifierKey(['email', 'phone']), message: TOO_MANY_ATTEMPTS, skipSuccessfulRequests: true });

// Password reset request / completion, change password.
const passwordIpLimiter = build({ windowMs: 15 * MINUTE, max: 10, keyGenerator: ipKey, message: 'Too many password operations. Please try again later.' });
const passwordResetAccountLimiter = build({ windowMs: 60 * MINUTE, max: 3, keyGenerator: identifierKey(['email']), message: 'Too many password operations. Please try again later.' });

// Federated sign-in.
const oauthLimiter = (provider) => build({ windowMs: 15 * MINUTE, max: 30, keyGenerator: ipKey, message: `Too many ${provider} auth attempts. Please try again later.` });

// Token refresh / account deletion and other authenticated-but-sensitive calls.
const sensitiveIpLimiter = build({ windowMs: 15 * MINUTE, max: 60, keyGenerator: ipKey, message: TOO_MANY_ATTEMPTS });

// Dedicated limiters for sensitive / quota-consuming endpoints:
// Geocoding (prevents draining Google Maps API billing/quota)
const geocodeLimiter = build({ windowMs: 15 * MINUTE, max: 60, keyGenerator: ipKey, message: 'Too many location requests. Please try again later.' });

// Support ticket submissions (prevents database spam and SMTP flooding)
const supportTicketLimiter = build({ windowMs: 15 * MINUTE, max: 10, keyGenerator: ipKey, message: 'Too many support tickets submitted. Please try again later.' });

// Newsletter subscriptions (prevents spamming newsletter list)
const newsletterLimiter = build({ windowMs: 15 * MINUTE, max: 5, keyGenerator: ipKey, message: 'Too many subscription attempts. Please try again later.' });

module.exports = {
  loginLimiters: [loginIpLimiter, loginAccountLimiter],
  otpSendLimiters: [otpSendIpLimiter, otpSendAccountLimiter],
  otpVerifyLimiters: [otpVerifyIpLimiter, otpVerifyAccountLimiter],
  passwordLimiters: [passwordIpLimiter],
  passwordResetRequestLimiters: [passwordIpLimiter, passwordResetAccountLimiter],
  googleOAuthLimiter: oauthLimiter('Google'),
  appleOAuthLimiter: oauthLimiter('Apple'),
  sensitiveIpLimiter,
  geocodeLimiter,
  supportTicketLimiter,
  newsletterLimiter
};
