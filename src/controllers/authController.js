const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const logger = require('../utils/logger');
const { getAuthCookieOptions } = require('../utils/authCookies');

const generateToken = (user) => {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error('JWT_SECRET environment variable is not set');
  }
  const payload = { id: user.id, roles: user.roles || [] };
  return jwt.sign(payload, jwtSecret, { expiresIn: '7d' });
};

// Create token and return cookie options (used by OAuth callback)
exports.createTokenForUser = async (user) => {
  const token = generateToken(user);
  const cookieOptions = getAuthCookieOptions();
  return { token, cookieOptions };
};

exports.register = async (req, res, next) => {
  try {
    const { name, email, password, phone, gender, dob, address, termsAccepted } = req.body;
    if (!termsAccepted) return res.status(400).json({ error: 'You must accept Terms & Privacy Policy' });

    // Input validation
    if (!name || name.length < 2 || name.length > 100) {
      return res.status(400).json({ error: 'Name must be between 2 and 100 characters' });
    }
    if (phone && !/^\d{10}$/.test(String(phone).replace(/\D/g, ''))) {
      return res.status(400).json({ error: 'Invalid phone number. Must be 10 digits.' });
    }
    if (dob && new Date(dob) > new Date()) {
      return res.status(400).json({ error: 'Date of birth cannot be in the future' });
    }
    if (address && String(address).length > 300) {
      return res.status(400).json({ error: 'Address must not exceed 300 characters' });
    }

    // Basic uniqueness checks (email is case-insensitive)
    if (email) {
      const emailLower = email.toLowerCase().trim();
      const existing = await User.findOne({ email: emailLower });
      if (existing) return res.status(400).json({ error: 'Email already in use' });
    }
    if (phone) {
      const existingPhone = await User.findOne({ phone });
      if (existingPhone) return res.status(400).json({ error: 'Phone number already in use' });
    }

    // If phone is provided, require a verification token proving the phone was verified
    if (phone) {
      const verificationToken = req.body.verificationToken || req.headers['x-phone-verification-token']
      if (!verificationToken) return res.status(400).json({ error: 'Phone verification required' })
      const jwtSecret = process.env.JWT_SECRET
      if (!jwtSecret) {
        return res.status(500).json({ error: 'Server configuration error' })
      }
      try {
        const payload = jwt.verify(verificationToken, jwtSecret)
        if (payload.phone !== phone) return res.status(400).json({ error: 'Verification token does not match phone' })
      } catch (e) {
        return res.status(400).json({ error: 'Invalid or expired phone verification token' })
      }
    }

    const user = new User({ name, email: email ? email.toLowerCase().trim() : email, password, phone, gender, dob: dob ? new Date(dob) : null, address, termsAccepted, roles: [] });
    await user.save();
    const { token, cookieOptions } = await exports.createTokenForUser(user);
    // set httpOnly cookie for session
    res.cookie('token', token, cookieOptions);
    res.json({ user: { id: user._id, email: user.email, name: user.name, roles: user.roles } });
  } catch (err) {
    // Handle duplicate key (unique index) errors more gracefully
    if (err && err.code === 11000) {
      const key = err.keyValue ? Object.keys(err.keyValue)[0] : 'field';
      return res.status(400).json({ error: `${key} already exists` });
    }
    next(err);
  }
};

exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    // Allow login by email or phone (case-insensitive for email)
    const emailLower = email ? email.toLowerCase().trim() : email;
    const user = await User.findOne({ $or: [{ email: emailLower }, { phone: email }] });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const match = await user.matchPassword(password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });
    if (user.blocked) return res.status(403).json({ error: 'Account blocked' });
    const { token, cookieOptions } = await exports.createTokenForUser(user);
    // set httpOnly cookie for session
    res.cookie('token', token, cookieOptions);
    res.json({ user: { id: user._id, email: user.email, name: user.name, roles: user.roles } });
  } catch (err) {
    next(err);
  }
};
