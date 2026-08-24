const express = require('express');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const router = express.Router();
const logger = require('../utils/logger');
const { hasUserSetPassword, verifyPasswordAndUpgrade } = require('../utils/password.util');
// Primary auth controller (MongoDB-backed)
const authController = require('../controllers/authController');
// Password reset and legacy handlers
const passport = require('../config/passport');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173'

const defaultFrontendUrls = [
  'http://localhost:5173',
  'http://localhost:5174',
  'https://doordripp.com',
  'https://www.doordripp.com',
]

const normalizeOrigin = (url) => {
  if (!url || typeof url !== 'string') return ''
  return url.trim().replace(/\/$/, '')
}

const allowedFrontendUrls = Array.from(
  new Set([FRONTEND_URL, ...defaultFrontendUrls].map(normalizeOrigin).filter(Boolean))
)

function getFrontendUrlForRequest(req) {
  const rawOrigin = req.get('origin')
  const rawReferer = req.get('referer')

  const candidateOrigins = []
  if (rawOrigin) candidateOrigins.push(rawOrigin)
  if (rawReferer) {
    try {
      candidateOrigins.push(new URL(rawReferer).origin)
    } catch (err) {
      logger.warn('Invalid Referer header while resolving frontend URL')
    }
  }

  for (const candidate of candidateOrigins) {
    const normalizedCandidate = normalizeOrigin(candidate)
    if (allowedFrontendUrls.includes(normalizedCandidate)) {
      return normalizedCandidate
    }
  }

  return normalizeOrigin(FRONTEND_URL)
}

const bcrypt = require('bcryptjs')
const Otp = require('../models/Otp')
const nodemailer = require('nodemailer')
const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN
const TWILIO_FROM = process.env.TWILIO_FROM
const smtpHost = process.env.MAIL_HOST || process.env.SMTP_HOST
const smtpPort = process.env.MAIL_PORT || process.env.SMTP_PORT || '587'
const smtpUser = process.env.MAIL_USER || process.env.SMTP_USER
const smtpPass = process.env.MAIL_PASS || process.env.SMTP_PASS
const smtpSecure = process.env.MAIL_SECURE === 'true' || process.env.SMTP_PORT === '465'

const normalizePhone = (phone) => String(phone || '').replace(/\D/g, '')
const isStrongEnoughPassword = (password) => typeof password === 'string' && password.length >= 8

// Check if rate limiting is disabled (for development)
const DISABLE_RATE_LIMIT = process.env.DISABLE_RATE_LIMIT === 'true'

// Middleware to skip rate limiting if disabled
const skipIfDisabled = (limiter) => {
  return (req, res, next) => {
    if (DISABLE_RATE_LIMIT) {
      return next()
    }
    return limiter(req, res, next)
  }
}

// Rate limiter: max 10 OTP requests per email per hour for registration (increased for development)
const registerOtpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.body?.email ? req.body.email.toLowerCase() : ipKeyGenerator(req)),
  handler: (req, res) => res.status(429).json({ error: 'Too many OTP requests. Please try again in an hour.' }),
});

// OAuth limiter: protect callback and initiation endpoints from abuse
const googleOAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req),
  handler: (req, res) => res.status(429).json({ error: 'Too many Google auth attempts. Please try again later.' }),
});

const appleOAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req),
  handler: (req, res) => res.status(429).json({ error: 'Too many Apple auth attempts. Please try again later.' }),
});

const passwordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req),
  handler: (req, res) => res.status(429).json({ error: 'Too many password operations. Please try again later.' }),
});

const hasGoogleOAuthProd = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
const hasGoogleOAuthDev = Boolean(process.env.GOOGLE_CLIENT_ID_DEV && process.env.GOOGLE_CLIENT_SECRET_DEV)

const handleOAuthCallback = (strategyName) => async (req, res, next) => {
  passport.authenticate(strategyName, { session: false }, async (err, user) => {
    let frontendUrl = getFrontendUrlForRequest(req);
    if (req.query.state) {
      try {
        const decodedState = Buffer.from(req.query.state, 'base64').toString('utf8');
        const normalized = normalizeOrigin(decodedState);
        if (allowedFrontendUrls.includes(normalized)) {
          frontendUrl = normalized;
        }
      } catch (e) {
        logger.warn('Failed to decode OAuth state parameter');
      }
    }
    if (err) {
      logger.error('Google OAuth error:', err);
    }
    if (!user) {
      logger.warn(`Google OAuth (${strategyName}): no user returned from strategy`);
    }
    if (err || !user) {
      const redirect = `${frontendUrl}/login?error=oauth_failed`;
      return res.redirect(redirect);
    }
    try {
      // create token + set cookie or redirect with token
      const { token, cookieOptions } = await authController.createTokenForUser(user);
      logger.info(`Google OAuth (${strategyName}) success for: ${user.email}`);
      // Set httpOnly cookie for token (frontend will rely on cookies)
      res.cookie('token', token, cookieOptions);
      // Redirect back to the frontend (SPA) home page
      return res.redirect(frontendUrl);
    } catch (e) {
      const redirect = `${frontendUrl}/login?error=server_error`;
      return res.redirect(redirect);
    }
  })(req, res, next);
}

// NOTE: Alias the legacy /register endpoint to the new initiate flow
// to ensure no user is created before email verification.
router.post(
  '/register',
  skipIfDisabled(registerOtpLimiter),
  body('name').isLength({ min: 3 }).withMessage('Name must be at least 3 characters'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('termsAccepted').isBoolean().custom((v) => v === true).withMessage('Terms must be accepted'),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    return authController.registerInitiate(req, res, next);
  }
);

// Step 1: Initiate registration with email OTP (no user created yet)
router.post(
  '/register-initiate',
  skipIfDisabled(registerOtpLimiter),
  body('name').isLength({ min: 3 }).withMessage('Name must be at least 3 characters'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('termsAccepted').isBoolean().custom((v) => v === true).withMessage('Terms must be accepted'),
  body('phone').optional().isString().withMessage('Phone must be a string'),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    return authController.registerInitiate(req, res, next);
  }
);

router.post(
  '/login',
  body('email').notEmpty(),
  body('password').notEmpty(),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    return authController.login(req, res, next);
  }
);

// Return currently authenticated user (checks cookie or Authorization header)
router.get('/me', authController.me);

// Logout
router.post('/logout', authController.logout);

// Refresh auth token (re-issue token if current token is valid)
router.post('/refresh', authController.refresh);
// Profile endpoint - returns current user data
router.get('/profile', authController.me);

// Forgot password - request password reset
router.post('/forgot-password', skipIfDisabled(passwordLimiter), authController.forgotPassword);

// Reset password with token
router.post('/reset-password', skipIfDisabled(passwordLimiter), authController.resetPassword);
// Email verification endpoints
router.post(
  '/verify-email-otp',
  body('email').isEmail(),
  body('code').isLength({ min: 6, max: 6 }),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    return authController.verifyEmailOTP(req, res, next);
  }
);

// Step 2: Verify OTP and create user
router.post(
  '/verify-email',
  body('email').isEmail().withMessage('Valid email is required'),
  body('otp').isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits').isNumeric(),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    return authController.verifyEmailRegistration(req, res, next);
  }
);

// Resend OTP for pending registration
router.post(
  '/register-resend',
  registerOtpLimiter,
  body('email').isEmail().withMessage('Valid email is required'),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    return authController.resendRegisterOtp(req, res, next);
  }
);

router.post(
  '/resend-email-otp',
  body('email').isEmail(),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    return authController.resendEmailOTP(req, res, next);
  }
);

// Upload avatar as a base64 dataURL in JSON: { avatar: 'data:image/png;base64,...' }
router.post('/avatar', authController.uploadAvatar);

// Update profile (address, phone, name, gender)
router.put('/profile', authController.updateProfile);

// Change password (authenticated)
router.put('/change-password', skipIfDisabled(passwordLimiter), authController.changePassword);

// POST /api/auth/send-otp
router.post('/send-otp', authController.sendOtp);

// POST /api/auth/verify-otp
router.post('/verify-otp', authController.verifyOtp);

// Google Sign-In with idToken (POST - for Flutter/mobile apps)
// Receives idToken from client, verifies it, and signs in or creates user
if (hasGoogleOAuthProd) {
  router.post('/google', skipIfDisabled(googleOAuthLimiter), async (req, res, next) => {
    try {
      return authController.signInWithGoogle(req, res, next);
    } catch (e) {
      logger.error('google idToken sign-in error', e);
      return res.status(500).json({ error: 'Failed to sign in with Google' });
    }
  });
}

// Sign-In with Apple (POST - for Flutter iOS/Android mobile apps)
// Receives identityToken & userIdentifier from client, verifies RS256 signature with Apple JWKS, and signs in or creates user
router.post('/apple', skipIfDisabled(appleOAuthLimiter), async (req, res, next) => {
  try {
    return authController.signInWithApple(req, res, next);
  } catch (e) {
    logger.error('Apple sign-in route error:', e);
    return res.status(500).json({ success: false, error: 'Failed to sign in with Apple' });
  }
});

// Google OAuth routes - only enable if Google creds are configured
if (hasGoogleOAuthProd) {
  router.get('/google', skipIfDisabled(googleOAuthLimiter), (req, res, next) => {
    const frontendUrl = getFrontendUrlForRequest(req);
    const state = Buffer.from(frontendUrl).toString('base64');
    // Initiates OAuth flow
    passport.authenticate('google', {
      scope: ['profile', 'email'],
      state: state
    })(req, res, next);
  });

  router.get('/google/callback', skipIfDisabled(googleOAuthLimiter), handleOAuthCallback('google'));
} else {
  // If Google OAuth is not configured, redirect to frontend login with an error
  router.get('/google', (req, res) => {
    const frontendUrl = getFrontendUrlForRequest(req);
    const redirect = `${frontendUrl}/login?error=oauth_not_configured`;
    return res.redirect(redirect);
  });

  router.get('/google/callback', (req, res) => {
    const frontendUrl = getFrontendUrlForRequest(req);
    const redirect = `${frontendUrl}/login?error=oauth_not_configured`;
    return res.redirect(redirect);
  });
}

// Dedicated Google OAuth DEV routes using independent credentials and callback URI
if (hasGoogleOAuthDev) {
  router.get('/google-auth-dev', skipIfDisabled(googleOAuthLimiter), (req, res, next) => {
    let frontendUrl = getFrontendUrlForRequest(req);
    // This route is exclusively for local development. If the frontend URL
    // resolved to a production domain (e.g. Referer was lost during the
    // cross-origin redirect), fall back to the first localhost URL in the
    // allowlist so the post-OAuth redirect stays on localhost.
    if (!frontendUrl.includes('localhost')) {
      frontendUrl = allowedFrontendUrls.find(u => u.includes('localhost')) || 'http://localhost:5173';
    }
    const state = Buffer.from(frontendUrl).toString('base64');
    passport.authenticate('google-auth-dev', {
      scope: ['profile', 'email'],
      state: state
    })(req, res, next);
  });

  router.get('/google-auth-dev/callback', skipIfDisabled(googleOAuthLimiter), handleOAuthCallback('google-auth-dev'));
} else {
  router.get('/google-auth-dev', (req, res) => {
    const frontendUrl = getFrontendUrlForRequest(req);
    const redirect = `${frontendUrl}/login?error=oauth_dev_not_configured`;
    return res.redirect(redirect);
  });

  router.get('/google-auth-dev/callback', (req, res) => {
    const frontendUrl = getFrontendUrlForRequest(req);
    const redirect = `${frontendUrl}/login?error=oauth_dev_not_configured`;
    return res.redirect(redirect);
  });
}

module.exports = router;

