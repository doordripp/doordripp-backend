const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { getAuthDocsUrl } = require('../utils/appUrls');

/**
 * Authentication Routes with Rate Limiting
 * 
 * Security Features:
 * - Rate limiting on all sensitive endpoints
 * - Input validation using express-validator
 * - Prevents brute force attacks on OTP verification
 * - Prevents email enumeration on password reset
 * 
 * @module AuthRoutes
 */

// ========== Rate Limiters ==========

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

/**
 * Rate limiter for OTP sending
 * Prevents spam and abuse
 * 
 * Limit: 5 requests per 15 minutes per IP
 */
const otpSendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per window
  message: {
    error: 'Too many OTP requests. Please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  skipSuccessfulRequests: false,
  skipFailedRequests: false,
  // Better key generator for production
  keyGenerator: (req) => {
    // Use forwarded IP for proxy/load balancer scenarios
    const forwarded = req.headers['x-forwarded-for'];
    const ip = forwarded ? forwarded.split(',')[0] : req.ip || req.connection.remoteAddress;
    return ip;
  },
  // Add request handler for custom behavior
  handler: (req, res) => {
    res.status(429).json({
      error: 'Too many OTP requests. Please try again later.',
      retryAfter: '15 minutes',
      limit: 5,
      window: '15 minutes'
    });
  }
});

/**
 * Rate limiter for OTP verification
 * Prevents brute force attacks
 * 
 * Limit: 10 attempts per 15 minutes per IP
 */
const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per window
  message: {
    error: 'Too many verification attempts. Please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * Rate limiter for password reset requests
 * Prevents email spam and enumeration attacks
 * 
 * Limit: 3 requests per 15 minutes per IP
 */
const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3, // 3 requests per window
  message: {
    error: 'Too many password reset requests. Please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Rate limiter for password reset token consumption
// Limit: 10 attempts per 15 minutes per IP to reduce brute force surface
const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    error: 'Too many password reset attempts. Please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// ========== Validation Middleware ==========

/**
 * Validation middleware wrapper
 * Returns 400 with validation errors if any
 */
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      error: 'Validation failed',
      details: errors.array() 
    });
  }
  next();
};

// ========== Routes ==========

/**
 * @route   POST /api/auth/send-otp
 * @desc    Send OTP to email for verification
 * @access  Public
 * @rateLimit 5 requests per 15 minutes
 * 
 * @body {string} email - User email address
 * @body {string} [purpose=signup] - Purpose: 'signup' | 'login' | 'verify-email' | 'reset-password'
 * 
 * @returns {200} { message, email, expiresIn, purpose }
 * @returns {400} { error } - Invalid input
 * @returns {429} { error, retryAfter } - Rate limit exceeded
 * @returns {500} { error } - Server error
 */
router.post(
  '/send-otp',
  skipIfDisabled(otpSendLimiter),
  [
    body('email')
      .isEmail()
      .withMessage('Valid email address is required')
      .normalizeEmail(),
    body('purpose')
      .optional()
      .isIn(['signup', 'login', 'verify-email', 'reset-password'])
      .withMessage('Invalid purpose')
  ],
  validate,
  authController.sendOTP
);

/**
 * @route   POST /api/auth/verify-otp
 * @desc    Verify OTP and complete email verification
 * @access  Public
 * @rateLimit 10 requests per 15 minutes
 * 
 * @body {string} email - User email address
 * @body {string} otp - 6-digit OTP code
 * 
 * @returns {200} { message, user, token } - Success (includes JWT token)
 * @returns {400} { error, remainingAttempts } - Invalid OTP
 * @returns {429} { error, retryAfter } - Rate limit exceeded
 * @returns {500} { error } - Server error
 * 
 * @security
 * - Maximum 3 verification attempts per OTP
 * - OTP deleted after successful verification
 * - JWT token set as httpOnly cookie
 */
router.post(
  '/verify-otp',
  skipIfDisabled(otpVerifyLimiter),
  [
    body('email')
      .isEmail()
      .withMessage('Valid email address is required')
      .normalizeEmail(),
    body('otp')
      .isLength({ min: 6, max: 6 })
      .withMessage('OTP must be 6 digits')
      .isNumeric()
      .withMessage('OTP must be numeric')
  ],
  validate,
  authController.verifyOTP
);

/**
 * @route   POST /api/auth/forgot-password
 * @desc    Request password reset email
 * @access  Public
 * @rateLimit 3 requests per 15 minutes
 * 
 * @body {string} email - User email address
 * 
 * @returns {200} { message } - Always returns success (security)
 * @returns {400} { error } - Invalid input
 * @returns {429} { error, retryAfter } - Rate limit exceeded
 * @returns {500} { error } - Server error
 * 
 * @security
 * - No indication if email exists (prevents user enumeration)
 * - Reset token expires in 1 hour
 * - Token is single-use only
 */
router.post(
  '/forgot-password',
  skipIfDisabled(passwordResetLimiter),
  [
    body('email')
      .isEmail()
      .withMessage('Valid email address is required')
      .normalizeEmail()
  ],
  validate,
  authController.forgotPassword
);

/**
 * @route   POST /api/auth/reset-password
 * @desc    Reset password using token from email
 * @access  Public
 * 
 * @body {string} token - JWT reset token from email
 * @body {string} newPassword - New password (min 8 characters)
 * 
 * @returns {200} { message } - Password reset successful
 * @returns {400} { error } - Invalid token or password
 * @returns {500} { error } - Server error
 * 
 * @security
 * - Token validated and checked for reuse
 * - Password hashed before storage
 * - Token invalidated after successful reset
 */
router.post(
  '/reset-password',
  skipIfDisabled(resetPasswordLimiter),
  [
    body('token')
      .notEmpty()
      .withMessage('Reset token is required'),
    body('newPassword')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters')
      .matches(/^(?=.*[A-Z])(?=.*\d)/)
      .withMessage('Password must contain at least one uppercase letter and one number')
  ],
  validate,
  authController.resetPassword
);

// ========== Documentation Route ==========

/**
 * @route   GET /api/auth/info
 * @desc    Get authentication system information
 * @access  Public
 */
router.get('/info', (req, res) => {
  res.json({
    service: 'DoorDripp Authentication API',
    version: '1.0.0',
    features: [
      'OTP-based email verification',
      'Password reset via email',
      'Rate-limited endpoints',
      'Input validation',
      'Secure JWT tokens'
    ],
    endpoints: {
      'POST /auth/send-otp': 'Send OTP to email',
      'POST /auth/verify-otp': 'Verify OTP and login',
      'POST /auth/forgot-password': 'Request password reset',
      'POST /auth/reset-password': 'Reset password with token'
    },
    security: {
      otpExpiration: '5 minutes',
      maxOtpAttempts: 3,
      resetTokenExpiration: '1 hour',
      rateLimits: {
        sendOtp: '5 requests per 15 minutes',
        verifyOtp: '10 requests per 15 minutes',
        resetPassword: '3 requests per 15 minutes'
      }
    },
    documentation: getAuthDocsUrl()
  });
});

module.exports = router;
