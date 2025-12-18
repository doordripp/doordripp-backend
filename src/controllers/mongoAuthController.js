const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Otp = require('../models/Otp');
const { sendEmailOTP } = require('../utils/email');

const generateToken = (user) => {
  const payload = { id: user._id, roles: user.roles || [] };
  return jwt.sign(payload, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });
};

exports.createTokenForUser = async (user) => {
  const token = generateToken(user);
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'none', // Required for cross-origin cookie transmission
    secure: true, // HTTPS only in production
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    // Use explicit cookie domain if provided; otherwise let browser set host-only cookie
    domain: process.env.COOKIE_DOMAIN || undefined,
  };
  return { token, cookieOptions };
};

// Refresh JWT by issuing a new token if the existing one is valid
exports.refresh = async (req, res) => {
  try {
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

    const { token: newToken, cookieOptions } = await exports.createTokenForUser(user);
    res.cookie('token', newToken, cookieOptions);
    return res.json({ ok: true, token: newToken });
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

exports.register = async (req, res, next) => {
  try {
    const { name, email, password, termsAccepted } = req.body;
    
    if (!termsAccepted) {
      return res.status(400).json({ error: 'You must accept Terms & Privacy Policy' });
    }

    // Check if email exists
    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ error: 'Email already in use' });
    }

    // Create user (password will be hashed by pre-save hook)
    // User is created but emailVerified remains false until OTP is verified
    const user = new User({
      name,
      email,
      password,
      roles: [],
      termsAccepted: true,
      emailVerified: false
    });
    await user.save();

    // Generate 6-digit OTP
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Save OTP to database
    await Otp.deleteMany({ identifier: email, type: 'email' });
    await Otp.create({ identifier: email, type: 'email', codeHash, expiresAt });

    // Send OTP via email
    const emailResult = await sendEmailOTP(email, code);

    res.json({ 
      message: 'Registration successful! Please check your email for verification code.',
      email,
      userId: user._id,
      emailSent: emailResult.success,
      requiresVerification: true
    });
  } catch (err) {
    if (err.code === 11000) {
      const key = Object.keys(err.keyValue)[0];
      return res.status(400).json({ error: `${key} already exists` });
    }
    next(err);
  }
};

exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check password
    const match = await user.matchPassword(password);
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check if blocked
    if (user.blocked) {
      return res.status(403).json({ error: 'Account blocked' });
    }

    // Check if email is verified
    if (!user.emailVerified) {
      return res.status(403).json({ 
        error: 'Email not verified',
        message: 'Please verify your email before logging in',
        email: user.email,
        requiresVerification: true
      });
    }

    const { token, cookieOptions } = await exports.createTokenForUser(user);
    res.cookie('token', token, cookieOptions);
    res.json({ 
      user: { id: user._id, email: user.email, name: user.name, roles: user.roles },
      token 
    });
  } catch (err) {
    next(err);
  }
};

exports.verifyEmailOTP = async (req, res, next) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ error: 'Email and OTP code are required' });
    }

    // Find the OTP record
    const otp = await Otp.findOne({ identifier: email, type: 'email' }).sort({ createdAt: -1 });
    if (!otp) {
      return res.status(400).json({ error: 'No OTP found for this email. Please request a new one.' });
    }

    // Check if OTP is expired
    if (otp.expiresAt < new Date()) {
      await Otp.deleteMany({ identifier: email, type: 'email' });
      return res.status(400).json({ error: 'OTP has expired. Please request a new one.' });
    }

    // Verify OTP code
    const match = await bcrypt.compare(code.toString(), otp.codeHash);
    if (!match) {
      return res.status(400).json({ error: 'Invalid OTP code' });
    }

    // OTP is valid - mark user as email verified
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.emailVerified = true;
    await user.save();

    // Delete used OTP
    await Otp.deleteMany({ identifier: email, type: 'email' });

    // Create token and log user in
    const { token, cookieOptions } = await exports.createTokenForUser(user);
    res.cookie('token', token, cookieOptions);

    res.json({
      message: 'Email verified successfully!',
      user: { id: user._id, email: user.email, name: user.name, roles: user.roles, emailVerified: user.emailVerified },
      token
    });
  } catch (err) {
    next(err);
  }
};

exports.resendEmailOTP = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Check if user exists
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if already verified
    if (user.emailVerified) {
      return res.status(400).json({ error: 'Email is already verified' });
    }

    // Generate new OTP
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Save OTP to database
    await Otp.deleteMany({ identifier: email, type: 'email' });
    await Otp.create({ identifier: email, type: 'email', codeHash, expiresAt });

    // Send OTP via email
    const emailResult = await sendEmailOTP(email, code);

    res.json({
      message: 'OTP sent successfully! Please check your email.',
      emailSent: emailResult.success
    });
  } catch (err) {
    next(err);
  }
};

exports.me = async (req, res, next) => {
  try {
    let token = null;
    if (req.cookies && req.cookies.token) token = req.cookies.token;
    if (!token && req.headers.authorization) {
      const parts = req.headers.authorization.split(' ');
      if (parts.length === 2 && parts[0] === 'Bearer') token = parts[1];
    }
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    const payload = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    const user = await User.findById(payload.id, '-password -refreshToken');
    if (!user) return res.status(401).json({ error: 'Invalid token user' });

    return res.json({ 
      _id: user._id, 
      name: user.name, 
      email: user.email, 
      roles: user.roles,
      avatar: user.avatar 
    });
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

exports.logout = async (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
};
