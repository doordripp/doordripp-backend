const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Otp = require('../models/Otp');
const { sendEmailOTP } = require('../utils/email');
const PendingUser = require('../models/PendingUser');
const otpUtil = require('../utils/otp.util');
const mailService = require('../services/mail.service');
const logger = require('../utils/logger');
const crypto = require('crypto');

const { getPermissionsForRoles } = require('../middleware/auth');

const getJwtSecret = () => {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error('JWT_SECRET environment variable is not set');
  }
  return jwtSecret;
};

const generateToken = (user) => {
  const payload = { 
    id: user._id, 
    userId: user._id,
    roles: user.roles || [],
    permissions: getPermissionsForRoles(user.roles || [])
  };
  return jwt.sign(payload, getJwtSecret(), { expiresIn: '7d' });
};

exports.createTokenForUser = async (user) => {
  const token = generateToken(user);
  // Allow cookies to work in local HTTP dev; tighten in prod/HTTPS.
  const isProdLike = process.env.NODE_ENV === 'production' || (process.env.BACKEND_URL || '').startsWith('https://');
  const secure = process.env.COOKIE_SECURE === 'true' || isProdLike;
  const cookieOptions = {
    httpOnly: true,
    sameSite: secure ? 'none' : 'lax',
    secure,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    domain: process.env.COOKIE_DOMAIN || undefined,
  };
  return { token, cookieOptions };
};

// Step 1: Initiate registration with email OTP, without creating a user record yet
exports.registerInitiate = async (req, res, next) => {
  try {
    const { name, email, password, termsAccepted, phone } = req.body || {};

    if (!termsAccepted) {
      return res.status(400).json({ error: 'You must accept Terms & Privacy Policy' });
    }

    if (!name || name.trim().length < 3) {
      return res.status(400).json({ error: 'Name must be at least 3 characters' });
    }

    if (!email || !otpUtil.sanitizeEmail(email)) {
      return res.status(400).json({ error: 'Valid email address is required' });
    }

    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const sanitizedEmail = otpUtil.sanitizeEmail(email);

    // Optional phone validation & uniqueness check
    let normalizedPhone = null;
    if (phone && String(phone).trim()) {
      const raw = String(phone).trim();
      // Basic normalization: remove spaces and hyphens; keep digits only
      const digits = raw.replace(/\D/g, '');
      // Accept common 10-13 digit formats; you can tighten this to your locale
      if (digits.length < 10 || digits.length > 13) {
        return res.status(400).json({ error: 'Please provide a valid phone number' });
      }
      normalizedPhone = digits;
      // Prevent duplicate phone if already used by a verified user
      const existingPhoneUser = await User.findOne({ phone: normalizedPhone });
      if (existingPhoneUser && existingPhoneUser.emailVerified) {
        return res.status(400).json({ error: 'Phone number already registered' });
      }
    }

    // Block duplicate registrations if a verified user already exists
    const existingUser = await User.findOne({ email: sanitizedEmail, emailVerified: true });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered. Please login instead.' });
    }

    // Hash password now; will reuse after OTP verification without rehashing
    const passwordHash = await bcrypt.hash(password, 10);

    // Generate OTP and hashes
    const otp = otpUtil.generateOTP();
    const otpHash = await otpUtil.hashOTP(otp);
    const expiryMinutes = parseInt(process.env.OTP_EXPIRY_MINUTES || '10', 10);
    const expiresAt = otpUtil.getExpirationTime(isNaN(expiryMinutes) ? 10 : expiryMinutes);

    // Upsert pending record
    await PendingUser.findOneAndUpdate(
      { email: sanitizedEmail },
      {
        email: sanitizedEmail,
        name: name.trim(),
        passwordHash,
        otpHash,
        expiresAt,
        attempts: 0,
        phone: normalizedPhone || undefined,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Send OTP via email
    await mailService.sendOtpEmail(sanitizedEmail, otp, 'signup');

    return res.json({
      message: 'OTP sent successfully. Please check your email.',
      email: otpUtil.maskEmail(sanitizedEmail),
      expiresIn: expiryMinutes * 60
    });
  } catch (err) {
    next(err);
  }
};

// Step 2: Verify OTP and create the user, marking email as verified
exports.verifyEmailRegistration = async (req, res, next) => {
  try {
    const { email, otp } = req.body || {};

    if (!email || !otpUtil.sanitizeEmail(email)) {
      return res.status(400).json({ error: 'Valid email address is required' });
    }

    if (!otpUtil.isValidOTPFormat(otp)) {
      return res.status(400).json({ error: 'OTP must be a 6-digit code' });
    }

    const sanitizedEmail = otpUtil.sanitizeEmail(email);

    const verifiedUser = await User.findOne({ email: sanitizedEmail, emailVerified: true });
    if (verifiedUser) {
      return res.status(400).json({ error: 'Email already registered. Please login instead.' });
    }

    const pending = await PendingUser.findOne({ email: sanitizedEmail });
    if (!pending) {
      return res.status(400).json({ error: 'No pending registration found for this email' });
    }

    if (otpUtil.isExpired(pending.expiresAt)) {
      await PendingUser.deleteOne({ email: sanitizedEmail });
      return res.status(400).json({ error: 'OTP has expired. Please request a new one.' });
    }

    const isMatch = await otpUtil.verifyOTP(otp, pending.otpHash);
    if (!isMatch) {
      // Increment attempts and optionally cap in future
      await PendingUser.findOneAndUpdate({ email: sanitizedEmail }, { $inc: { attempts: 1 } });
      return res.status(400).json({ error: 'Invalid OTP' });
    }

    // If an unverified user exists (from legacy flow), update it; otherwise create a new user
    let user = await User.findOne({ email: sanitizedEmail });
    if (user) {
      if (user.emailVerified) {
        // Race-condition safety check (should have been caught above)
        await PendingUser.deleteOne({ email: sanitizedEmail });
        return res.status(400).json({ error: 'Email already registered. Please login instead.' });
      }
      user.password = pending.passwordHash;
      user.emailVerified = true;
      user.termsAccepted = true;
      user.skipPasswordHash = true; // prevent re-hashing pre-hashed password
      // If pending had phone/gender/dob, set them where appropriate
      if (pending.phone) {
        // Ensure phone is not taken by another user
        const other = await User.findOne({ phone: pending.phone, _id: { $ne: user._id } });
        if (other) {
          return res.status(400).json({ error: 'Phone number already in use by another account' });
        }
        user.phone = pending.phone;
        user.phoneVerified = false;
      }
      await user.save();
    } else {
      user = new User({
        name: pending.name,
        email: sanitizedEmail,
        password: pending.passwordHash,
        emailVerified: true,
        termsAccepted: true,
        phone: pending.phone || undefined,
        phoneVerified: false,
        isPasswordSet: true,
      });
      user.skipPasswordHash = true; // prevent re-hashing pre-hashed password
      await user.save();
    }

    // Clean up pending record
    await PendingUser.deleteOne({ email: sanitizedEmail });

    const { token, cookieOptions } = await exports.createTokenForUser(user);
    res.cookie('token', token, cookieOptions);

    return res.json({
      message: 'Registration complete and email verified',
      user: { id: user._id, email: user.email, name: user.name },
      token
    });
  } catch (err) {
    next(err);
  }
};

// Resend OTP for pending registration
exports.resendRegisterOtp = async (req, res, next) => {
  try {
    const { email } = req.body || {};
    if (!email || !otpUtil.sanitizeEmail(email)) {
      return res.status(400).json({ error: 'Valid email address is required' });
    }
    const sanitizedEmail = otpUtil.sanitizeEmail(email);

    const pending = await PendingUser.findOne({ email: sanitizedEmail });
    if (!pending) {
      return res.status(400).json({ error: 'No pending registration found for this email' });
    }

    // Generate new OTP and update
    const otp = otpUtil.generateOTP();
    const otpHash = await otpUtil.hashOTP(otp);
    const expiryMinutes = parseInt(process.env.OTP_EXPIRY_MINUTES || '10', 10);
    const expiresAt = otpUtil.getExpirationTime(isNaN(expiryMinutes) ? 10 : expiryMinutes);

    pending.otpHash = otpHash;
    pending.expiresAt = expiresAt;
    await pending.save();

    await mailService.sendOtpEmail(sanitizedEmail, otp, 'signup');

    return res.json({
      message: 'OTP resent successfully. Please check your email.',
      email: otpUtil.maskEmail(sanitizedEmail),
      expiresIn: expiryMinutes * 60
    });
  } catch (err) {
    next(err);
  }
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

    const payload = jwt.verify(token, getJwtSecret());
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

    // Find user by email (case-insensitive)
    const emailLower = email ? email.toLowerCase().trim() : email;
    const user = await User.findOne({ email: emailLower });
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

// Verify Google idToken and sign in or create user
exports.signInWithGoogle = async (req, res, next) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({ error: 'idToken is required' });
    }

    const { OAuth2Client } = require('google-auth-library');
    const client = new OAuth2Client();

    // Accept one web client ID + two app client IDs.
    const ACCEPTED_CLIENT_IDS = [
      process.env.GOOGLE_CLIENT_ID, // Web client ID
      process.env.GOOGLE_APP_CLIENT_ID_1,
      process.env.GOOGLE_APP_CLIENT_ID_2,
    ].filter(clientId => Boolean(clientId && clientId.trim()));

    if (ACCEPTED_CLIENT_IDS.length === 0) {
      logger.error('No Google client IDs configured for idToken verification');
      return res.status(500).json({ error: 'Google login is not configured' });
    }

    let ticket;
    let payload;
    let usedClientId = null;

    // Try verification with each allowed audience until one works.
    for (const clientId of ACCEPTED_CLIENT_IDS) {
      try {
        ticket = await client.verifyIdToken({
          idToken: idToken,
          audience: clientId,
        });
        payload = ticket.getPayload();
        usedClientId = clientId;
        break; // Success! Exit the loop
      } catch (err) {
        // Continue to next client ID
        logger.warn('Google token verification failed for one audience candidate');
      }
    }

    // Reject tokens that do not match any explicit trusted audience.
    if (!payload) {
      logger.warn('Google token verification failed for all configured audiences');
      return res.status(401).json({ error: 'Invalid Google token audience' });
    }

    // Extract user info from payload
    const email = payload.email;
    const name = payload.name || payload.email.split('@')[0];
    const picture = payload.picture;
    const googleId = payload.sub;

    logger.info(`Google token verified for: ${email}`);
    logger.info(`Google token client/audience: ${usedClientId || payload.aud}`);

    // Find or create user (maintains backward compatibility)
    let user = await User.findOne({ email });

    if (!user) {
      // Create new user
      const pwd = crypto.randomBytes(16).toString('hex');
      user = new User({
        name,
        email,
        password: pwd,
        emailVerified: true,
        avatar: picture || null,
        roles: [],
        termsAccepted: true,
        googleId, // Store Google ID for future reference
        authProvider: 'google',
        isPasswordSet: false
      });
      await user.save();
      logger.info(`New user created from Google: ${email}`);
    } else {
      // Update existing user if needed (preserves existing data)
      let updated = false;

      if (!user.emailVerified) {
        user.emailVerified = true;
        updated = true;
      }

      // Update avatar if missing or if it's a Google avatar (but preserve custom avatars)
      if (picture && (!user.avatar || user.avatar.includes('googleusercontent.com'))) {
        user.avatar = picture;
        updated = true;
      }

      // Store Google ID if not already present
      if (!user.googleId) {
        user.googleId = googleId;
        updated = true;
      }

      // Set auth provider if not set
      if (!user.authProvider) {
        user.authProvider = 'google';
        updated = true;
      }

      if (updated) {
        await user.save();
      }
      logger.info(`Existing user accessed via Google: ${email}`);
    }

    // Generate JWT token (same for website and app)
    const { token, cookieOptions } = await exports.createTokenForUser(user);

    // Return response (compatible with both website and app)
    return res.json({
      success: true,
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        roles: user.roles || [],
        avatar: user.avatar,
        phone: user.phone || null,
        emailVerified: user.emailVerified,
        isPasswordSet: user.isPasswordSet || false,
      },
    });

  } catch (err) {
    logger.error('signInWithGoogle error', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to sign in with Google'
    });
  }
};

exports.me = async (req, res, next) => {
  try {
    let token = null;
    if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }
    if (!token && req.headers.authorization) {
      const parts = req.headers.authorization.split(' ');
      if (parts.length === 2 && parts[0] === 'Bearer') {
        token = parts[1];
      }
    }
    if (!token) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const payload = jwt.verify(token, getJwtSecret());
    const user = await User.findById(payload.id, '-password -refreshToken');
    if (!user) return res.status(401).json({ error: 'Invalid token user' });

    return res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      roles: user.roles,
      avatar: user.avatar,
      phone: user.phone || null,
      address: user.address || null,
      googleId: user.googleId || null,
      isPasswordSet: user.isPasswordSet || false
    });
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

exports.logout = async (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
};
