const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

const generateToken = (user) => {
  const payload = { id: user.id, roles: user.roles || [] };
  return jwt.sign(payload, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });
};

// Create token and return cookie options (used by OAuth callback)
exports.createTokenForUser = async (user) => {
  const token = generateToken(user);
  // Allow http-only cookie to work locally over HTTP; force secure in prod/HTTPS.
  const isProdLike = process.env.NODE_ENV === 'production' || (process.env.BACKEND_URL || '').startsWith('https://');
  const secure = process.env.COOKIE_SECURE === 'true' || isProdLike;
  const cookieOptions = {
    httpOnly: true,
    sameSite: secure ? 'none' : 'lax',
    secure,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    domain: process.env.COOKIE_DOMAIN || (process.env.NODE_ENV === 'production' ? '.doordripp.com' : undefined),
  };
  return { token, cookieOptions };
};

exports.register = async (req, res, next) => {
  try {
    const { name, email, password, phone, gender, dob, address, termsAccepted } = req.body;
    if (!termsAccepted) return res.status(400).json({ error: 'You must accept Terms & Privacy Policy' });

    // Basic uniqueness checks
    if (email) {
      const existing = await User.findOne({ email });
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
      try {
        const payload = jwt.verify(verificationToken, process.env.JWT_SECRET || 'secret')
        if (payload.phone !== phone) return res.status(400).json({ error: 'Verification token does not match phone' })
      } catch (e) {
        return res.status(400).json({ error: 'Invalid or expired phone verification token' })
      }
    }

    const user = new User({ name, email, password, phone, gender, dob: dob ? new Date(dob) : null, address, termsAccepted, roles: [] });
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
    // Allow login by email or phone
    const user = await User.findOne({ $or: [{ email }, { phone: email }] });
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
