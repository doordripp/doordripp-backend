const express = require('express');
const { body, validationResult } = require('express-validator');
const router = express.Router();
const authController = require('../controllers/authController');
const passport = require('../config/passport');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173'

const bcrypt = require('bcryptjs')
const Otp = require('../models/Otp')
const nodemailer = require('nodemailer')
const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN
const TWILIO_FROM = process.env.TWILIO_FROM

router.post(
  '/register',
  body('name').isLength({ min: 3 }),
  body('email').isEmail(),
  body('phone').matches(/^[6-9]\d{9}$/).withMessage('Phone must be a valid 10-digit Indian number'),
  body('password').isLength({ min: 6 }),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    return authController.register(req, res, next);
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
router.get('/me', async (req, res) => {
  try {
    const jwt = require('jsonwebtoken');
    const User = require('../models/User');
    let token = null;
    // Prefer cookie token
    if (req.cookies && req.cookies.token) token = req.cookies.token;
    // Fallback to Authorization header
    if (!token && req.headers.authorization) {
      const parts = req.headers.authorization.split(' ');
      if (parts.length === 2 && parts[0] === 'Bearer') token = parts[1];
    }
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    const user = await User.findById(payload.id).lean();
    if (!user) return res.status(401).json({ error: 'Invalid token user' });
    return res.json({ _id: user._id, name: user.name, email: user.email, role: user.roles, avatar: user.avatar });
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
});

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
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'secret');
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
      console.error('Sharp processing failed; ensure `sharp` is installed', err.message || err);
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
    console.error('Avatar upload error', e);
    return res.status(500).json({ error: 'Failed to upload avatar' });
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
          console.error('Twilio send failed', e)
          responses.push({ to: phone, via: 'sms', error: 'Twilio send failed' })
        }
      } else {
        console.log(`OTP for ${phone}: ${code}`)
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
          console.error('Email send failed', e)
          responses.push({ to: email, via: 'email', error: 'Email send failed' })
        }
      } else {
        console.log(`OTP for ${email}: ${code}`)
        responses.push({ to: email, via: 'log' })
      }
    }

    return res.json({ ok: true, message: 'OTP sent', results: responses })
  } catch (e) {
    console.error('send-otp error', e)
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
    const verificationToken = jwt.sign({ phone }, process.env.JWT_SECRET || 'secret', { expiresIn: '10m' })

    return res.json({ ok: true, message: 'OTP verified', verificationToken })
  } catch (e) {
    console.error('verify-otp error', e)
    return res.status(500).json({ error: 'Failed to verify OTP' })
  }
})

// Google OAuth routes - only enable if Google creds are configured
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  router.get('/google', (req, res, next) => {
    // Initiates OAuth flow
    passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
  });

  router.get('/google/callback', (req, res, next) => {
    passport.authenticate('google', { session: false }, async (err, user) => {
      if (err || !user) {
        const redirect = `${FRONTEND_URL}/login?error=oauth_failed`;
        return res.redirect(redirect);
      }
      try {
        // create token + set cookie or redirect with token
        const { token, cookieOptions } = await authController.createTokenForUser(user);
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

