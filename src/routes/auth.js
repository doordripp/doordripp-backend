const express = require('express');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const router = express.Router();
const logger = require('../utils/logger');
// Primary auth controller (MongoDB-backed)
const authController = require('../controllers/mongoAuthController');
// Password reset and legacy handlers
const passwordController = require('../controllers/auth.controller');
const passport = require('../config/passport');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://:5173'

const bcrypt = require('bcryptjs')
const Otp = require('../models/Otp')
const nodemailer = require('nodemailer')
const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN
const TWILIO_FROM = process.env.TWILIO_FROM

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

// NOTE: Alias the legacy /register endpoint to the new initiate flow
// to ensure no user is created before email verification.
router.post(
  '/register',
  skipIfDisabled(registerOtpLimiter),
  body('name').isLength({ min: 3 }).withMessage('Name must be at least 3 characters'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
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
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
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
router.post('/forgot-password', async (req, res, next) => {
  try {
    return passwordController.forgotPassword(req, res, next);
  } catch (e) {
    logger.error('forgot-password error', e);
    return res.status(500).json({ error: 'Failed to process password reset request' });
  }
});

// Reset password with token
router.post('/reset-password', async (req, res, next) => {
  try {
    return passwordController.resetPassword(req, res, next);
  } catch (e) {
    logger.error('reset-password error', e);
    return res.status(500).json({ error: 'Failed to reset password' });
  }
});
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
router.post('/avatar', async (req, res) => {
  try {
    const jwt = require('jsonwebtoken');
    const User = require('../models/User');
    let token = null;
    if (req.cookies && req.cookies.token) token = req.cookies.token;
    if (!token && req.headers.authorization) {
      const parts = req.headers.authorization.split(' ');
      if (parts.length === 2 && parts[0] === 'Bearer') token = parts[1];
    }
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) return res.status(500).json({ error: 'Server configuration error' });
    const payload = jwt.verify(token, jwtSecret);
    const user = await User.findById(payload.id);
    if (!user) return res.status(401).json({ error: 'Invalid token user' });

    const { avatar } = req.body || {};
    if (!avatar || typeof avatar !== 'string') return res.status(400).json({ error: 'No avatar provided' });

    // Parse data URL
    const matches = avatar.match(/^data:(image\/[^;]+);base64,(.+)$/);
    if (!matches) return res.status(400).json({ error: 'Invalid avatar format' });
    const mime = matches[1];
    const data = matches[2];
    const buffer = Buffer.from(data, 'base64');

    // Basic validation
    const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (!allowed.includes(mime.toLowerCase())) return res.status(400).json({ error: 'Unsupported image type' });

    const MAX_BYTES = 2 * 1024 * 1024 // 2 MB
    if (buffer.length > MAX_BYTES) return res.status(400).json({ error: 'Image too large (max 2MB)' });

    const path = require('path');
    const fs = require('fs');
    const uploadsDir = path.join(__dirname, '..', 'public', 'uploads', 'avatars');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

    // Process image with sharp (resize + convert to jpeg) to limit dimensions and file size
    let outBuffer = buffer;
    try {
      const sharp = require('sharp');
      outBuffer = await sharp(buffer)
        .resize(512, 512, { fit: 'cover' })
        .rotate() // normalize orientation
        .toFormat('jpeg', { quality: 80 })
        .toBuffer();
    } catch (err) {
      logger.error('Sharp processing failed; ensure `sharp` is installed', err);
      return res.status(500).json({ error: 'Image processing failed (sharp missing or failed). Please install sharp.' });
    }

    const filename = `${user._id}.jpg`;
    const filePath = path.join(uploadsDir, filename);
    fs.writeFileSync(filePath, outBuffer);

    // Set avatar URL (served from /uploads)
    user.avatar = `/uploads/avatars/${filename}`;
    await user.save();

    return res.json({ avatar: user.avatar });
  } catch (e) {
    logger.error('Avatar upload error', e);
    return res.status(500).json({ error: 'Failed to upload avatar' });
  }
});

// Update profile (address, phone, name, gender)
router.put('/profile', async (req, res) => {
  try {
    const jwt = require('jsonwebtoken');
    const User = require('../models/User');
    let token = null;
    if (req.cookies && req.cookies.token) token = req.cookies.token;
    if (!token && req.headers.authorization) {
      const parts = req.headers.authorization.split(' ');
      if (parts.length === 2 && parts[0] === 'Bearer') token = parts[1];
    }
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    const jwtSecretProfile = process.env.JWT_SECRET;
    if (!jwtSecretProfile) return res.status(500).json({ error: 'Server configuration error' });
    const payload = jwt.verify(token, jwtSecretProfile);
    const user = await User.findById(payload.id);
    if (!user) return res.status(401).json({ error: 'Invalid token user' });

    const { name, phone, address } = req.body || {};
    if (typeof name === 'string' && name.trim()) user.name = name.trim();
    if (typeof phone === 'string' && phone.trim()) user.phone = phone.trim();
    if (address && typeof address === 'object') {
      user.address = user.address || {};
      user.address.street = address.street || user.address.street;
      user.address.city = address.city || user.address.city;
      user.address.state = address.state || user.address.state;
      user.address.zip = address.zip || user.address.zip;
    }
    await user.save();
    return res.json({ ok: true, user: { id: user._id, name: user.name, email: user.email, phone: user.phone, address: user.address } });
  } catch (e) {
    logger.error('profile update error', e);
    return res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Change password (authenticated)
router.put('/change-password', async (req, res) => {
  try {
    const jwt = require('jsonwebtoken');
    const User = require('../models/User');
    let token = null;
    if (req.cookies && req.cookies.token) token = req.cookies.token;
    if (!token && req.headers.authorization) {
      const parts = req.headers.authorization.split(' ');
      if (parts.length === 2 && parts[0] === 'Bearer') token = parts[1];
    }
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    const jwtSecretPwd = process.env.JWT_SECRET;
    if (!jwtSecretPwd) return res.status(500).json({ error: 'Server configuration error' });
    const payload = jwt.verify(token, jwtSecretPwd);
    const user = await User.findById(payload.id);
    if (!user) return res.status(401).json({ error: 'Invalid token user' });

    const { currentPassword, newPassword } = req.body || {};
    if (!newPassword) return res.status(400).json({ error: 'New password is required' });

    // Only check current password if a password was previously set
    if (user.isPasswordSet) {
      if (!currentPassword) return res.status(400).json({ error: 'Current password is required' });
      const match = await user.matchPassword(currentPassword);
      if (!match) return res.status(400).json({ error: 'Current password is incorrect' });
    }

    if (typeof newPassword !== 'string' || newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });

    user.password = newPassword;
    user.isPasswordSet = true;
    await user.save();
    return res.json({ ok: true, message: 'Password updated' });
  } catch (e) {
    logger.error('change-password error', e);
    return res.status(500).json({ error: 'Failed to change password' });
  }
});

// POST /api/auth/send-otp
router.post('/send-otp', async (req, res) => {
  try {
    const { phone, email } = req.body || {}
    if (!phone && !email) return res.status(400).json({ error: 'Phone or email is required' })

    // Generate 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString()
    const salt = await bcrypt.genSalt(10)
    const codeHash = await bcrypt.hash(code, salt)
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000) // 5 minutes

    const responses = []

    // Send to phone if provided
    if (phone) {
      if (!/^[6-9]\d{9}$/.test(phone)) return res.status(400).json({ error: 'Invalid phone number' })
      // Save OTP for phone (remove previous entries)
      await Otp.deleteMany({ identifier: phone, type: 'phone' })
      await Otp.create({ identifier: phone, type: 'phone', codeHash, expiresAt })

      if (TWILIO_SID && TWILIO_TOKEN && TWILIO_FROM) {
        try {
          const client = require('twilio')(TWILIO_SID, TWILIO_TOKEN)
          await client.messages.create({ body: `Your OTP code is ${code}`, from: TWILIO_FROM, to: `+91${phone}` })
          responses.push({ to: phone, via: 'sms' })
        } catch (e) {
          logger.error('Twilio send failed', e);
          responses.push({ to: phone, via: 'sms', error: 'Twilio send failed' })
        }
      } else {
        logger.debug(`OTP for ${phone}: ${code}`);
        responses.push({ to: phone, via: 'log' })
      }
    }

    // Send to email if provided
    if (email) {
      // Save OTP for email (remove previous entries)
      await Otp.deleteMany({ identifier: email, type: 'email' })
      await Otp.create({ identifier: email, type: 'email', codeHash, expiresAt })

      if (process.env.MAIL_HOST && process.env.MAIL_USER && process.env.MAIL_PASS) {
        try {
          const transporter = nodemailer.createTransport({
            host: process.env.MAIL_HOST,
            port: parseInt(process.env.MAIL_PORT || '587'),
            secure: (process.env.MAIL_SECURE === 'true'),
            auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS }
          })
          const mailFrom = process.env.MAIL_FROM || process.env.MAIL_USER
          await transporter.sendMail({ from: mailFrom, to: email, subject: 'Your OTP code', text: `Your OTP code is ${code}` })
          responses.push({ to: email, via: 'email' })
        } catch (e) {
          logger.error('Email send failed', e);
          responses.push({ to: email, via: 'email', error: 'Email send failed' })
        }
      } else {
        logger.debug(`OTP for ${email}: ${code}`);
        responses.push({ to: email, via: 'log' })
      }
    }

    return res.json({ ok: true, message: 'OTP sent', results: responses })
  } catch (e) {
    logger.error('send-otp error', e);
    return res.status(500).json({ error: 'Failed to send OTP' })
  }
})

// POST /api/auth/verify-otp
router.post('/verify-otp', async (req, res) => {
  try {
    const { phone, email, code } = req.body || {}
    const identifier = phone || email
    if (!identifier || !code) return res.status(400).json({ error: 'Identifier and code are required' })

    const type = phone ? 'phone' : 'email'

    const otp = await Otp.findOne({ identifier, type }).sort({ createdAt: -1 })
    if (!otp) return res.status(400).json({ error: 'No OTP requested for this phone' })
    if (otp.expiresAt < new Date()) {
      await Otp.deleteMany({ identifier, type })
      return res.status(400).json({ error: 'OTP expired' })
    }

    const match = await bcrypt.compare(code.toString(), otp.codeHash)
    if (!match) return res.status(400).json({ error: 'Invalid OTP' })

    // OTP valid - remove entries
    await Otp.deleteMany({ identifier, type })

    // If a user exists with this identifier, mark verified
    const User = require('../models/User')
    const user = phone ? await User.findOne({ phone }) : await User.findOne({ email })
    if (user) {
      if (type === 'phone') user.phoneVerified = true
      else user.emailVerified = true
      await user.save()
    }

    // Issue a short-lived verification token that proves the phone was verified
    const jwt = require('jsonwebtoken')
    const jwtSecretOtp = process.env.JWT_SECRET;
    if (!jwtSecretOtp) return res.status(500).json({ error: 'Server configuration error' });
    const verificationToken = jwt.sign({ phone }, jwtSecretOtp, { expiresIn: '10m' })

    return res.json({ ok: true, message: 'OTP verified', verificationToken })
  } catch (e) {
    logger.error('verify-otp error', e);
    return res.status(500).json({ error: 'Failed to verify OTP' })
  }
})

// Google Sign-In with idToken (POST - for Flutter/mobile apps)
// Receives idToken from client, verifies it, and signs in or creates user
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  router.post('/google', async (req, res, next) => {
    try {
      return authController.signInWithGoogle(req, res, next);
    } catch (e) {
      logger.error('google idToken sign-in error', e);
      return res.status(500).json({ error: 'Failed to sign in with Google' });
    }
  });
}

// Google OAuth routes - only enable if Google creds are configured
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  router.get('/google', (req, res, next) => {
    // Initiates OAuth flow
    passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
  });

  router.get('/google/callback', (req, res, next) => {
    passport.authenticate('google', { session: false }, async (err, user) => {
      if (err) {
        logger.error('Google OAuth error:', err);
      }
      if (!user) {
        logger.warn('Google OAuth: no user returned from strategy');
      }
      if (err || !user) {
        const redirect = `${FRONTEND_URL}/login?error=oauth_failed`;
        return res.redirect(redirect);
      }
      try {
        // create token + set cookie or redirect with token
        const { token, cookieOptions } = await authController.createTokenForUser(user);
        logger.info(`Google OAuth success for: ${user.email}`);
        // Set httpOnly cookie for token (frontend will rely on cookies)
        res.cookie('token', token, cookieOptions);
        // Redirect back to the frontend (SPA) home page
        return res.redirect(FRONTEND_URL);
      } catch (e) {
        const redirect = `${FRONTEND_URL}/login?error=server_error`;
        return res.redirect(redirect);
      }
    })(req, res, next);
  });
} else {
  // If Google OAuth is not configured, redirect to frontend login with an error
  router.get('/google', (req, res) => {
    const redirect = `${FRONTEND_URL}/login?error=oauth_not_configured`;
    return res.redirect(redirect);
  });

  router.get('/google/callback', (req, res) => {
    const redirect = `${FRONTEND_URL}/login?error=oauth_not_configured`;
    return res.redirect(redirect);
  });
}

module.exports = router;

