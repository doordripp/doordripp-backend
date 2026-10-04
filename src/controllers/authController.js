const crypto = require('crypto');
const mongoose = require('mongoose');
const {
  signAuthToken,
  signPurposeToken,
  verifyPurposeToken,
  verifyToken: verifyJwt,
  hashToken
} = require('../config/auth');
const { authenticateRequest, extractToken, AuthError } = require('../middleware/auth');
const RevokedToken = require('../models/RevokedToken');
const { verifyGoogleIdToken, GoogleAuthError } = require('../utils/googleAuth');
const logger = require('../utils/logger');
const nodemailer = require('nodemailer');
const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM = process.env.TWILIO_FROM;
const smtpHost = process.env.MAIL_HOST || process.env.SMTP_HOST;
const smtpPort = process.env.MAIL_PORT || process.env.SMTP_PORT || '587';
const smtpUser = process.env.MAIL_USER || process.env.SMTP_USER;
const smtpPass = process.env.MAIL_PASS || process.env.SMTP_PASS;
const smtpSecure = process.env.MAIL_SECURE === 'true' || process.env.SMTP_PORT === '465';
const isStrongEnoughPassword = (password) => typeof password === 'string' && password.length >= 8;

const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Otp = require('../models/Otp');
const { sendEmailOTP } = require('../utils/email');
const PendingUser = require('../models/PendingUser');
const otpUtil = require('../utils/otp.util');
const mailService = require('../services/mail.service');
const { hasUserSetPassword, verifyPasswordAndUpgrade } = require('../utils/password.util');

const normalizeEmail = (email) => otpUtil.sanitizeEmail(String(email || ''));
const normalizePhone = (phone) => String(phone || '').replace(/\D/g, '');
const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const generateToken = (user) => signAuthToken(user);

const MAX_OTP_ATTEMPTS = 5;
const randomPassword = () => crypto.randomBytes(24).toString('hex');
const isAccountBlocked = (user) => Boolean(user && (user.blocked || user.isBanned));

// Resolve the authenticated user for handlers mounted without the verifyToken
// middleware. Sends the error response itself and returns null on failure.
const requireUser = async (req, res) => {
  try {
    const { user } = await authenticateRequest(req);
    return user;
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.status === 401 ? 'Not authenticated' : err.message });
      return null;
    }
    throw err;
  }
};

exports.createTokenForUser = async (user) => {
  const token = generateToken(user);
  // Allow cookies to work in local HTTP dev; tighten in prod/HTTPS.
  const isProdLike = process.env.NODE_ENV === 'production' || (process.env.BACKEND_URL || '').startsWith('https://');
  const secure = process.env.COOKIE_SECURE === 'true' || isProdLike;
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'strict',
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

    const sanitizedEmail = normalizeEmail(email);
    if (!email || !isValidEmail(sanitizedEmail)) {
      return res.status(400).json({ error: 'Valid email address is required' });
    }

    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

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
      if (existingPhoneUser) {
        return res.status(400).json({ error: 'Phone number already registered' });
      }
      const existingPendingPhone = await PendingUser.findOne({ phone: normalizedPhone, email: { $ne: sanitizedEmail } });
      if (existingPendingPhone) {
        return res.status(400).json({ error: 'Phone number is already pending verification' });
      }
    }

    // Block duplicate registrations if any user already exists (OAuth or password, verified or not)
    const existingUser = await User.findOne({ email: sanitizedEmail });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists. Please login or use password reset.', userExists: true });
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
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
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

    const sanitizedEmail = normalizeEmail(email);
    if (!email || !isValidEmail(sanitizedEmail)) {
      return res.status(400).json({ error: 'Valid email address is required' });
    }

    if (!otpUtil.isValidOTPFormat(otp)) {
      return res.status(400).json({ error: 'OTP must be a 6-digit code' });
    }

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

    if ((pending.attempts || 0) >= MAX_OTP_ATTEMPTS) {
      await PendingUser.deleteOne({ email: sanitizedEmail });
      return res.status(400).json({ error: 'Too many incorrect attempts. Please register again to get a new OTP.' });
    }

    const isMatch = await otpUtil.verifyOTP(otp, pending.otpHash);
    if (!isMatch) {
      await PendingUser.updateOne({ email: sanitizedEmail }, { $inc: { attempts: 1 } });
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
      user.isPasswordSet = true;
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
      });
      user.isPasswordSet = true;
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
    const sanitizedEmail = normalizeEmail(email);
    if (!email || !isValidEmail(sanitizedEmail)) {
      return res.status(400).json({ error: 'Valid email address is required' });
    }

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
    pending.attempts = 0;
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
    const { user } = await authenticateRequest(req);
    const { token: newToken, cookieOptions } = await exports.createTokenForUser(user);
    res.cookie('token', newToken, cookieOptions);
    return res.json({ ok: true, token: newToken });
  } catch (e) {
    if (e instanceof AuthError && e.status !== 401) {
      return res.status(e.status).json({ error: e.message });
    }
    return res.status(401).json({ error: extractToken(req) ? 'Invalid token' : 'Not authenticated' });
  }
};

exports.register = async (req, res, next) => {
  try {
    const { name, email, password, termsAccepted } = req.body;
    const sanitizedEmail = normalizeEmail(email);
    
    if (!termsAccepted) {
      return res.status(400).json({ error: 'You must accept Terms & Privacy Policy' });
    }

    // Check if email exists
    if (!isValidEmail(sanitizedEmail)) {
      return res.status(400).json({ error: 'Valid email address is required' });
    }

    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const existing = await User.findOne({ email: sanitizedEmail });
    if (existing) {
      return res.status(400).json({ error: 'Email already in use' });
    }

    // Create user (password will be hashed by pre-save hook)
    // User is created but emailVerified remains false until OTP is verified
    const user = new User({
      name,
      email: sanitizedEmail,
      password,
      roles: [],
      termsAccepted: true,
      emailVerified: false
    });
    await user.save();

    // Generate 6-digit OTP
    const code = otpUtil.generateOTP();
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Save OTP to database
    await Otp.deleteMany({ identifier: sanitizedEmail, type: 'email' });
    await Otp.create({ identifier: sanitizedEmail, type: 'email', codeHash, expiresAt });

    // Send OTP via email
    const emailResult = await sendEmailOTP(sanitizedEmail, code);

    res.json({ 
      message: 'Registration successful! Please check your email for verification code.',
      email: sanitizedEmail,
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
    const loginIdentifier = String(email || '').trim();
    const phone = normalizePhone(loginIdentifier);
    const emailLower = normalizeEmail(loginIdentifier);

    // Find user by email or phone. The frontend sends the field as "email" for both.
    const user = await User.findOne(
      phone.length >= 10 && !loginIdentifier.includes('@')
        ? { phone }
        : { email: emailLower }
    );
    if (!user || user.isDeleted) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check password
    const match = await verifyPasswordAndUpgrade(user, password);
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check if blocked / banned
    if (isAccountBlocked(user)) {
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

// Legacy flow: verify the email of an account that exists but is still unverified.
// It never signs in an already-verified account, so an OTP can not be used as a
// password-less login for someone else's verified account.
exports.verifyEmailOTP = async (req, res, next) => {
  try {
    const { email, code } = req.body;
    const sanitizedEmail = normalizeEmail(email);

    if (!email || !isValidEmail(sanitizedEmail) || !code) {
      return res.status(400).json({ error: 'Email and OTP code are required' });
    }

    const invalid = () => res.status(400).json({ error: 'Invalid or expired OTP. Please request a new one.' });
    const otpFilter = { identifier: sanitizedEmail, type: 'email', purpose: 'verify-email' };

    const otp = await Otp.findOne(otpFilter).sort({ createdAt: -1 });
    if (!otp) return invalid();

    if (otp.expiresAt < new Date() || (otp.attempts || 0) >= MAX_OTP_ATTEMPTS) {
      await Otp.deleteMany(otpFilter);
      return invalid();
    }

    const match = await bcrypt.compare(String(code), otp.codeHash);
    if (!match) {
      await Otp.updateOne({ _id: otp._id }, { $inc: { attempts: 1 } });
      return invalid();
    }

    const user = await User.findOne({ email: sanitizedEmail });
    if (!user || user.isDeleted || user.emailVerified || isAccountBlocked(user)) {
      await Otp.deleteMany(otpFilter);
      return invalid();
    }

    user.emailVerified = true;
    await user.save();
    await Otp.deleteMany(otpFilter);

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
    const sanitizedEmail = normalizeEmail(email);

    if (!email || !isValidEmail(sanitizedEmail)) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Same answer whether or not the address belongs to an (unverified) account.
    const generic = { message: 'If this email needs verification, an OTP has been sent.', emailSent: true };

    const user = await User.findOne({ email: sanitizedEmail });
    if (!user || user.isDeleted || user.emailVerified) {
      return res.json(generic);
    }

    const code = otpUtil.generateOTP();
    const codeHash = await otpUtil.hashOTP(code);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    const otpFilter = { identifier: sanitizedEmail, type: 'email', purpose: 'verify-email' };

    await Otp.deleteMany(otpFilter);
    await Otp.create({ ...otpFilter, codeHash, expiresAt });

    await sendEmailOTP(sanitizedEmail, code);

    res.json(generic);
  } catch (err) {
    next(err);
  }
};

// Verify Google idToken and sign in or create user
exports.signInWithGoogle = async (req, res, next) => {
  try {
    const { idToken } = req.body || {};

    if (!idToken || typeof idToken !== 'string') {
      return res.status(400).json({ error: 'idToken is required' });
    }

    // Signature, issuer, expiry AND audience are all enforced. There is no
    // fallback path: a token minted for any other OAuth client is rejected.
    let payload;
    try {
      payload = await verifyGoogleIdToken(idToken);
    } catch (err) {
      if (err instanceof GoogleAuthError) {
        if (err.status >= 500) logger.error(`Google sign-in unavailable: ${err.reason}`);
        else logger.warn(`Google sign-in rejected: ${err.reason}`);
        return res.status(err.status).json({ success: false, error: err.message });
      }
      throw err;
    }

    const email = normalizeEmail(payload.email);
    const name = payload.name || email.split('@')[0];
    const picture = payload.picture;
    const googleId = payload.sub;

    // Find or create user (maintains backward compatibility)
    let user = await User.findOne({ email });

    if (!user) {
      // Create new user
      user = new User({
        name,
        email,
        password: randomPassword(),
        emailVerified: true,
        avatar: picture || null,
        roles: [],
        termsAccepted: true,
        authProvider: 'google',
        googleId, // Store Google ID for future reference
        isPasswordSet: false // Mark that they haven't explicitly set a password yet
      });
      await user.save();
    } else {
      if (user.isDeleted || isAccountBlocked(user)) {
        return res.status(403).json({ success: false, error: 'Account blocked' });
      }
      // Update existing user if needed (preserves existing data)
      let updated = false;
      const hadLocalPassword = user.authProvider !== 'google' && !!user.password;
      
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
      
      // Set auth provider once Google is linked
      if (user.authProvider !== 'google') {
        user.authProvider = 'google';
        updated = true;
      }

      if (hadLocalPassword && !user.isPasswordSet) {
        user.isPasswordSet = true;
        updated = true;
      }
      
      if (updated) {
        await user.save();
      }
    }

    // Generate JWT token (same for website and app)
    const { token } = await exports.createTokenForUser(user);

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

// Verify Apple identityToken and sign in or create user (for Flutter/iOS/mobile apps)
exports.signInWithApple = async (req, res, next) => {
  try {
    const { identityToken, name, fullName } = req.body || {};

    if (!identityToken) {
      return res.status(400).json({ success: false, error: 'identityToken is required' });
    }

    const { verifyAppleIdToken } = require('../utils/appleAuth');
    let verified;
    try {
      verified = await verifyAppleIdToken(identityToken);
    } catch (verifyErr) {
      logger.error('Apple token verification failed:', verifyErr.message);
      return res.status(401).json({ success: false, error: 'Invalid Apple identity token' });
    }

    // Identity comes only from the verified token, never from the request body.
    const appleId = verified.appleId;
    if (!appleId) {
      return res.status(400).json({ success: false, error: 'Could not extract Apple user identifier' });
    }

    // Resolve name if sent by Apple (Apple only sends name on the very first sign-in!)
    let resolvedName = '';
    if (typeof name === 'string' && name.trim()) {
      resolvedName = name.trim();
    } else if (typeof fullName === 'string' && fullName.trim()) {
      resolvedName = fullName.trim();
    } else if (name && typeof name === 'object') {
      const first = name.firstName || name.givenName || '';
      const last = name.lastName || name.familyName || '';
      resolvedName = `${first} ${last}`.trim();
    } else if (fullName && typeof fullName === 'object') {
      const first = fullName.givenName || fullName.firstName || '';
      const last = fullName.familyName || fullName.lastName || '';
      resolvedName = `${first} ${last}`.trim();
    }

    // 1. Try finding user by appleId
    let user = await User.findOne({ appleId });

    // 2. If not found by appleId, try finding by email
    // Only an email that Apple itself asserts as verified may link to an existing account.
    const targetEmail = verified.email && verified.emailVerified ? normalizeEmail(verified.email) : null;

    if (!user && targetEmail) {
      user = await User.findOne({ email: targetEmail });
    }

    if (!user) {
      // If we don't have an email at all (very rare edge case), fallback to private relay alias
      const userEmail = targetEmail || `${appleId}@privaterelay.appleid.com`;
      const finalName = resolvedName || (targetEmail ? targetEmail.split('@')[0] : 'Apple User');

      user = new User({
        name: finalName,
        email: userEmail,
        password: randomPassword(),
        emailVerified: true,
        appleId,
        authProvider: 'apple',
        roles: [],
        termsAccepted: true,
        isPasswordSet: false
      });
      await user.save();
      logger.info(`New user created via Sign In with Apple: ${user._id}`);
    } else {
      if (user.isDeleted || isAccountBlocked(user)) {
        return res.status(403).json({ success: false, error: 'Account blocked' });
      }
      // Existing user found - link Apple ID and update missing fields
      let updated = false;
      if (!user.appleId) {
        user.appleId = appleId;
        updated = true;
      }
      if (!user.emailVerified) {
        user.emailVerified = true;
        updated = true;
      }
      if (resolvedName && (user.name === 'Apple User' || !user.name)) {
        user.name = resolvedName;
        updated = true;
      }
      if (updated) {
        await user.save();
      }
      logger.info(`Existing user authenticated via Apple: ${user._id}`);
    }

    // Generate JWT token
    const { token, cookieOptions } = await exports.createTokenForUser(user);

    if (res.cookie) {
      res.cookie('token', token, cookieOptions);
    }

    return res.json({
      success: true,
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        roles: user.roles || [],
        avatar: user.avatar || null,
        phone: user.phone || null,
        emailVerified: user.emailVerified,
        authProvider: user.authProvider || 'apple'
      }
    });
  } catch (err) {
    logger.error('❌ signInWithApple error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to sign in with Apple'
    });
  }
};

exports.me = async (req, res, next) => {
  try {
    let user;
    try {
      ({ user } = await authenticateRequest(req));
    } catch (authErr) {
      return res.json({ authenticated: false });
    }
    const isPasswordSet = hasUserSetPassword(user);

    return res.json({
      authenticated: true,
      _id: user._id,
      name: user.name,
      email: user.email,
      roles: user.roles,
      avatar: user.avatar,
      phone: user.phone || null,
      address: user.address || null,
      googleId: user.googleId || null,
      authProvider: user.authProvider || 'local',
      isPasswordSet,
      emailVerified: !!user.emailVerified,
      phoneVerified: !!user.phoneVerified
    });
  } catch (e) {
    return res.json({ authenticated: false });
  }
};

// Server-side revocation: the presented token is put on a denylist until it
// would have expired, so a copied token stops working the moment the user logs out.
exports.logout = async (req, res) => {
  const token = extractToken(req);
  if (token) {
    try {
      const payload = verifyJwt(token);
      if (payload && payload.id && !payload.purpose && payload.exp) {
        await RevokedToken.updateOne(
          { tokenHash: hashToken(token) },
          { $setOnInsert: { tokenHash: hashToken(token), user: payload.id, expiresAt: new Date(payload.exp * 1000) } },
          { upsert: true }
        );
      }
    } catch (err) {
      // Invalid/expired token: nothing to revoke. A storage failure must be visible though.
      if (err && err.name !== 'JsonWebTokenError' && err.name !== 'TokenExpiredError' && err.code !== 11000) {
        logger.error('Failed to revoke token on logout', err);
        return res.status(500).json({ error: 'Failed to log out' });
      }
    }
  }
  res.clearCookie('token');
  res.json({ ok: true });
};


exports.uploadAvatar = async (req, res, next) => {
  try {
    const user = await requireUser(req, res);
    if (!user) return;

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
}

exports.updateProfile = async (req, res, next) => {
  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const { name, phone, address } = req.body || {};
    if (typeof name === 'string' && name.trim()) user.name = name.trim();
    if (typeof phone === 'string' && phone.trim()) {
      const normalizedPhone = normalizePhone(phone);
      if (normalizedPhone.length < 10 || normalizedPhone.length > 13) {
        return res.status(400).json({ error: 'Please provide a valid phone number' });
      }
      const existingPhoneUser = await User.findOne({ phone: normalizedPhone, _id: { $ne: user._id } });
      if (existingPhoneUser) {
        return res.status(400).json({ error: 'Phone number already registered' });
      }
      user.phone = normalizedPhone;
    }
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
}

exports.changePassword = async (req, res, next) => {
  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const { currentPassword, newPassword } = req.body || {};
    if (!newPassword) return res.status(400).json({ error: 'New password is required' });

    const requiresCurrentPassword = hasUserSetPassword(user);

    // Local and legacy-password accounts must prove the current password.
    // OAuth-only accounts can set their first password from an authenticated session.
    if (requiresCurrentPassword) {
      if (!currentPassword) return res.status(400).json({ error: 'Current password is required' });
      const match = await verifyPasswordAndUpgrade(user, currentPassword);
      if (!match) return res.status(400).json({ error: 'Current password is incorrect' });
    }

    if (!isStrongEnoughPassword(newPassword)) return res.status(400).json({ error: 'New password must be at least 8 characters' });

    user.password = newPassword;
    user.isPasswordSet = true;
    user.skipPasswordHash = false;
    // Changing the password ends every OTHER session. The session making the change
    // stays valid (clients that ignore the fresh token below are not signed out).
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    user.keepTokenHash = hashToken(extractToken(req));
    await user.save();
    const { token, cookieOptions } = await exports.createTokenForUser(user);
    res.cookie('token', token, cookieOptions);
    return res.json({ ok: true, message: 'Password updated', token });
  } catch (e) {
    logger.error('change-password error', e);
    return res.status(500).json({ error: 'Failed to change password' });
  }
}

// Contact verification for the SIGNED-IN user only.
// The caller can request/confirm an OTP for their own email, or for a phone
// number they are attaching to their own account. Nothing here can touch another
// account: the identifier is never used to look up a different user.
const CONTACT_OTP_PURPOSE = 'verify-contact';

const resolveOwnContact = async (user, { phone, email }) => {
  if (phone) {
    const normalized = normalizePhone(phone);
    if (!/^[6-9]\d{9}$/.test(normalized)) return { error: 'Invalid phone number' };
    const owner = await User.findOne({ phone: normalized, _id: { $ne: user._id } }).select('_id').lean();
    if (owner) return { error: 'Phone number already registered' };
    return { type: 'phone', identifier: normalized };
  }
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || normalizedEmail !== user.email) {
    return { error: 'You can only verify the email address of your own account' };
  }
  return { type: 'email', identifier: normalizedEmail };
};

exports.sendOtp = async (req, res, next) => {
  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const { phone, email } = req.body || {};
    if (!phone && !email) return res.status(400).json({ error: 'Phone or email is required' });

    const contact = await resolveOwnContact(user, { phone, email });
    if (contact.error) return res.status(400).json({ error: contact.error });

    const code = otpUtil.generateOTP();
    const codeHash = await otpUtil.hashOTP(code);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
    const otpFilter = { identifier: contact.identifier, type: contact.type, purpose: CONTACT_OTP_PURPOSE, user: user._id };

    await Otp.deleteMany(otpFilter);
    await Otp.create({ ...otpFilter, codeHash, expiresAt });

    const responses = [];
    if (contact.type === 'phone') {
      if (TWILIO_SID && TWILIO_TOKEN && TWILIO_FROM) {
        try {
          const client = require('twilio')(TWILIO_SID, TWILIO_TOKEN);
          await client.messages.create({ body: `Your OTP code is ${code}`, from: TWILIO_FROM, to: `+91${contact.identifier}` });
          responses.push({ to: contact.identifier, via: 'sms' });
        } catch (e) {
          logger.error('Twilio send failed', e);
          responses.push({ to: contact.identifier, via: 'sms', error: 'SMS send failed' });
        }
      } else {
        // The code itself is never written to logs.
        logger.warn('SMS provider is not configured; phone OTP was not delivered');
        responses.push({ to: contact.identifier, via: 'none', error: 'SMS delivery is not configured' });
      }
    } else {
      const emailResult = await sendEmailOTP(contact.identifier, code);
      responses.push({ to: contact.identifier, via: 'email', ...(emailResult && emailResult.success === false ? { error: 'Email send failed' } : {}) });
    }

    return res.json({ ok: true, message: 'OTP sent', results: responses });
  } catch (e) {
    logger.error('send-otp error', e);
    return res.status(500).json({ error: 'Failed to send OTP' });
  }
};

exports.verifyOtp = async (req, res, next) => {
  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const { phone, email, code } = req.body || {};
    if ((!phone && !email) || !code) return res.status(400).json({ error: 'Identifier and code are required' });

    const contact = await resolveOwnContact(user, { phone, email });
    if (contact.error) return res.status(400).json({ error: contact.error });

    const invalid = () => res.status(400).json({ error: 'Invalid or expired OTP' });
    const otpFilter = { identifier: contact.identifier, type: contact.type, purpose: CONTACT_OTP_PURPOSE, user: user._id };

    const otp = await Otp.findOne(otpFilter).sort({ createdAt: -1 });
    if (!otp) return invalid();
    if (otp.expiresAt < new Date() || (otp.attempts || 0) >= MAX_OTP_ATTEMPTS) {
      await Otp.deleteMany(otpFilter);
      return invalid();
    }

    const match = await bcrypt.compare(String(code), otp.codeHash);
    if (!match) {
      await Otp.updateOne({ _id: otp._id }, { $inc: { attempts: 1 } });
      return invalid();
    }

    await Otp.deleteMany(otpFilter);

    if (contact.type === 'phone') {
      user.phone = contact.identifier;
      user.phoneVerified = true;
    } else {
      user.emailVerified = true;
    }
    try {
      await user.save();
    } catch (saveErr) {
      if (saveErr && saveErr.code === 11000) return res.status(400).json({ error: 'Phone number already registered' });
      throw saveErr;
    }

    // Short-lived proof that THIS user verified THIS contact. Not usable as a session token.
    const verificationToken = signPurposeToken(
      { sub: String(user._id), [contact.type]: contact.identifier },
      'contact-verification',
      '10m'
    );

    return res.json({ ok: true, message: 'OTP verified', verificationToken });
  } catch (e) {
    logger.error('verify-otp error', e);
    return res.status(500).json({ error: 'Failed to verify OTP' });
  }
};

exports.forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({
        error: 'Email address is required'
      });
    }

    const sanitizedEmail = otpUtil.sanitizeEmail(email);

    // Find user (don't reveal if user exists)
    const user = await User.findOne({ email: sanitizedEmail });

    // Always return success (prevent user enumeration attack)
    const successMessage = 'If this email is registered, you will receive password reset instructions.';

    if (!user || user.isDeleted) {
      return res.json({ message: successMessage });
    }

    // Generate password reset token (JWT)
    // Token payload includes user ID and purpose
    const resetToken = signPurposeToken(
      { id: String(user._id), nonce: crypto.randomBytes(16).toString('hex') },
      'password-reset',
      '1h'
    );

    // Store reset token hash in user document (for validation)
    // This allows us to invalidate the token after use
    const tokenHash = crypto
      .createHash('sha256')
      .update(resetToken)
      .digest('hex');
    
    user.resetPasswordToken = tokenHash;
    user.resetPasswordExpires = new Date(Date.now() + 3600000); // 1 hour
    
    try {
      await user.save();
    } catch (saveError) {
      logger.error('Failed to save password reset token to user:', saveError);
      return res.status(500).json({ 
        error: 'Failed to process password reset request' 
      });
    }

    // Send password reset email
    try {
      await mailService.sendPasswordResetEmail(
        sanitizedEmail,
        resetToken,
        user.name
      );
      
      logger.info(`Password reset email sent to ${otpUtil.maskEmail(sanitizedEmail)}`);
    } catch (emailError) {
      logger.error('Failed to send reset email:', emailError);
      // Don't reveal email sending failure to user - they should still see success
    }

    res.json({ message: successMessage });

  } catch (error) {
    logger.error('Forgot password error:', error);
    res.status(500).json({ 
      error: 'Failed to process password reset request'
    });
  }
};

exports.resetPassword = async (req, res, next) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword || typeof token !== 'string' || typeof newPassword !== 'string') {
      return res.status(400).json({ 
        error: 'Token and new password are required' 
      });
    }

    // Validate password strength
    if (newPassword.length < 8) {
      return res.status(400).json({ 
        error: 'Password must be at least 8 characters long' 
      });
    }

    // Verify signature, expiry and purpose
    let decoded;
    try {
      decoded = verifyPurposeToken(token, 'password-reset');
    } catch (err) {
      return res.status(400).json({
        error: 'Invalid or expired reset token'
      });
    }

    // Find user
    const user = await User.findById(decoded.id);
    if (!user || user.isDeleted) {
      return res.status(400).json({
        error: 'Invalid or expired reset token'
      });
    }

    // Verify token hash matches (prevents token reuse)
    const tokenHash = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');

    // Use timing-safe comparison to prevent timing attacks
    let storedHash;
    let providedHash;
    try {
      storedHash = Buffer.from(user.resetPasswordToken || '', 'hex');
      providedHash = Buffer.from(tokenHash, 'hex');
    } catch (err) {
      return res.status(400).json({
        error: 'Invalid or already used reset token'
      });
    }
    
    let isValidToken = false;
    if (storedHash.length === providedHash.length) {
      isValidToken = crypto.timingSafeEqual(storedHash, providedHash);
    }

    if (!user.resetPasswordToken || !isValidToken) {
      return res.status(400).json({ 
        error: 'Invalid or already used reset token' 
      });
    }

    // Check token expiration
    if (!user.resetPasswordExpires || user.resetPasswordExpires < new Date()) {
      return res.status(400).json({ 
        error: 'Reset token has expired. Please request a new one.' 
      });
    }

    // Store the raw password and let the User model own hashing consistently.
    user.password = newPassword;
    user.skipPasswordHash = false;
    user.isPasswordSet = true;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    // A password reset signs the account out everywhere.
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    user.keepTokenHash = null;
    await user.save();

    logger.info(`Password reset successful for user: ${user._id}`);

    // Notify user of successful password reset (best-effort)
    try {
      await mailService.sendPasswordResetSuccessEmail(user.email, user.name || 'User');
    } catch (notifyErr) {
      logger.error('Failed to send password reset success email:', notifyErr);
    }

    res.json({ 
      message: 'Password reset successful. You can now login with your new password.' 
    });

  } catch (error) {
    logger.error('Reset password error:', error);
    res.status(500).json({ 
      error: 'Failed to reset password' 
    });
  }
};

/**
 * Delete Account
 * See services/accountDeletion.service.js for what is removed, anonymised and retained.
 * Idempotent: repeating the call with the same credential after a successful
 * deletion answers 200 again instead of an error.
 */
exports.deleteAccount = async (req, res, next) => {
  try {
    let user;
    try {
      ({ user } = await authenticateRequest(req, { allowDeleted: true }));
    } catch (authErr) {
      if (authErr instanceof AuthError) {
        // A token that predates the deletion (older token version) still identifies
        // the tombstoned account: treat the retry as already done.
        const prior = await findDeletedUserForToken(req);
        if (prior) {
          res.clearCookie('token');
          return res.json({ success: true, message: 'Account deleted successfully' });
        }
        return res.status(authErr.status).json({ error: authErr.status === 401 ? 'Not authenticated' : authErr.message });
      }
      throw authErr;
    }

    if (!user.isDeleted) {
      const { deleteUserAccount } = require('../services/accountDeletion.service');
      await deleteUserAccount(user._id);
      logger.info(`Account deleted for user ID: ${user._id}`);
    }

    res.clearCookie('token');
    return res.json({
      success: true,
      message: 'Account deleted successfully'
    });
  } catch (error) {
    logger.error('Delete account error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to delete account'
    });
  }
};

async function findDeletedUserForToken(req) {
  const token = extractToken(req);
  if (!token) return null;
  try {
    const payload = verifyJwt(token);
    if (!payload || !payload.id || payload.purpose || !mongoose.Types.ObjectId.isValid(payload.id)) return null;
    return await User.findOne({ _id: payload.id, isDeleted: true }).select('_id').lean();
  } catch (err) {
    return null;
  }
}
