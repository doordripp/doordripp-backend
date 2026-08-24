const jwt = require('jsonwebtoken');
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

const generateToken = (user) => {
  const payload = { id: user._id, roles: user.roles || [] };
  return jwt.sign(payload, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });
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
    const code = Math.floor(100000 + Math.random() * 900000).toString();
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
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check password
    const match = await verifyPasswordAndUpgrade(user, password);
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
    const sanitizedEmail = normalizeEmail(email);

    if (!email || !isValidEmail(sanitizedEmail) || !code) {
      return res.status(400).json({ error: 'Email and OTP code are required' });
    }

    // Find the OTP record
    const otp = await Otp.findOne({ identifier: sanitizedEmail, type: 'email' }).sort({ createdAt: -1 });
    if (!otp) {
      return res.status(400).json({ error: 'No OTP found for this email. Please request a new one.' });
    }

    // Check if OTP is expired
    if (otp.expiresAt < new Date()) {
      await Otp.deleteMany({ identifier: sanitizedEmail, type: 'email' });
      return res.status(400).json({ error: 'OTP has expired. Please request a new one.' });
    }

    // Verify OTP code
    const match = await bcrypt.compare(code.toString(), otp.codeHash);
    if (!match) {
      return res.status(400).json({ error: 'Invalid OTP code' });
    }

    // OTP is valid - mark user as email verified
    const user = await User.findOne({ email: sanitizedEmail });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.emailVerified = true;
    await user.save();

    // Delete used OTP
    await Otp.deleteMany({ identifier: sanitizedEmail, type: 'email' });

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
    const sanitizedEmail = normalizeEmail(email);

    if (!email || !isValidEmail(sanitizedEmail)) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Check if user exists
    const user = await User.findOne({ email: sanitizedEmail });
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
    await Otp.deleteMany({ identifier: sanitizedEmail, type: 'email' });
    await Otp.create({ identifier: sanitizedEmail, type: 'email', codeHash, expiresAt });

    // Send OTP via email
    const emailResult = await sendEmailOTP(sanitizedEmail, code);

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
    
    // Define ALL accepted client IDs (both website and app)
    const ACCEPTED_CLIENT_IDS = [
      process.env.GOOGLE_CLIENT_ID,        // Primary Web Client ID
      process.env.GOOGLE_APP_CLIENT_ID_1,  // Flutter App Client ID 1
      process.env.GOOGLE_APP_CLIENT_ID_2,  // Flutter App Client ID 2
      '72023349261-71l2pk4f8vptk9vgpll8iutjql0qj9ia.apps.googleusercontent.com',
      '1000596440300-qpmt33mqedhlgsk435dov0o2g95hn8h9.apps.googleusercontent.com'
    ].filter(Boolean); // Remove any undefined/null values

    let ticket;
    let payload;
    let usedClientId = null;
    
    // Try verification with each client ID until one works
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
        console.log(`⚠️ Verification failed with client ID: ${clientId.substring(0, 20)}...`);
      }
    }
    
    // If no client ID worked, try one last verification without specifying audience
    if (!payload) {
      try {
        console.log('🔄 Trying verification without audience specification...');
        ticket = await client.verifyIdToken({
          idToken: idToken,
          // No audience specified - accepts any valid Google token
        });
        payload = ticket.getPayload();
        
        // Log the actual audience for debugging
        console.log(`📝 Token has audience: ${payload.aud}`);
        
        // Check if this audience should be trusted
        const actualAudience = payload.aud;
        if (!ACCEPTED_CLIENT_IDS.includes(actualAudience)) {
          console.log(`⚠️ Token has untrusted audience: ${actualAudience}`);
          // Still accept it, but log a warning
        }
      } catch (err) {
        console.error('❌ All verification attempts failed:', err.message);
        return res.status(401).json({ error: 'Invalid Google token' });
      }
    }

    // Extract user info from payload
    const email = normalizeEmail(payload.email);
    const name = payload.name || payload.email.split('@')[0];
    const picture = payload.picture;
    const googleId = payload.sub;

    console.log(`✅ Google token verified for: ${email}`);
    console.log(`🔑 Used client ID: ${usedClientId || 'None (audience: ' + payload.aud + ')'}`);

    // Find or create user (maintains backward compatibility)
    let user = await User.findOne({ email });

    if (!user) {
      // Create new user
      const pwd = Math.random().toString(36).slice(-12);
      user = new User({
        name,
        email,
        password: pwd,
        emailVerified: true,
        avatar: picture || null,
        roles: [],
        termsAccepted: true,
        authProvider: 'google',
        googleId, // Store Google ID for future reference
        isPasswordSet: false // Mark that they haven't explicitly set a password yet
      });
      await user.save();
      console.log(`✅ New user created from Google: ${email}`);
    } else {
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
      console.log(`✅ Existing user accessed via Google: ${email}`);
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
      },
    });
    
  } catch (err) {
    console.error('❌ signInWithGoogle error:', err.message);
    console.error('📝 Stack trace:', err.stack);
    return res.status(500).json({ 
      success: false,
      error: 'Failed to sign in with Google' 
    });
  }
};

// Verify Apple identityToken and sign in or create user (for Flutter/iOS/mobile apps)
exports.signInWithApple = async (req, res, next) => {
  try {
    const { identityToken, userIdentifier, name, fullName, email: fallbackEmail } = req.body || {};

    if (!identityToken) {
      return res.status(400).json({ success: false, error: 'identityToken is required' });
    }

    const { verifyAppleIdToken } = require('../utils/appleAuth');
    let verified;
    try {
      verified = await verifyAppleIdToken(identityToken);
    } catch (verifyErr) {
      logger.error('Apple token verification failed:', verifyErr.message);
      return res.status(401).json({ success: false, error: verifyErr.message || 'Invalid Apple identity token' });
    }

    const appleId = verified.appleId || userIdentifier;
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
    const tokenEmail = verified.email ? normalizeEmail(verified.email) : null;
    const clientEmail = fallbackEmail ? normalizeEmail(fallbackEmail) : null;
    const targetEmail = tokenEmail || clientEmail;

    if (!user && targetEmail) {
      user = await User.findOne({ email: targetEmail });
    }

    if (!user) {
      // If we don't have an email at all (very rare edge case), fallback to private relay alias
      const userEmail = targetEmail || `${appleId}@privaterelay.appleid.com`;
      const finalName = resolvedName || (targetEmail ? targetEmail.split('@')[0] : 'Apple User');
      const randomPassword = Math.random().toString(36).slice(-12) + Math.random().toString(36).slice(-12);

      user = new User({
        name: finalName,
        email: userEmail,
        password: randomPassword,
        emailVerified: true,
        appleId,
        authProvider: 'apple',
        roles: [],
        termsAccepted: true,
        isPasswordSet: false
      });
      await user.save();
      logger.info(`✅ New user created via Sign In with Apple: ${user.email} (${appleId})`);
    } else {
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
      logger.info(`✅ Existing user authenticated via Apple: ${user.email} (${appleId})`);
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
      return res.json({ authenticated: false });
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    const user = await User.findById(payload.id, '-refreshToken');
    if (!user) return res.json({ authenticated: false });
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

exports.logout = async (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
};


exports.uploadAvatar = async (req, res, next) => {
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
}

exports.updateProfile = async (req, res, next) => {
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
    await user.save();
    return res.json({ ok: true, message: 'Password updated' });
  } catch (e) {
    logger.error('change-password error', e);
    return res.status(500).json({ error: 'Failed to change password' });
  }
}

exports.sendOtp = async (req, res, next) => {
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

      if (smtpHost && smtpUser && smtpPass) {
        try {
          const transporter = nodemailer.createTransport({
            host: smtpHost,
            port: parseInt(smtpPort, 10),
            secure: smtpSecure,
            auth: { user: smtpUser, pass: smtpPass }
          })
          const mailFrom = process.env.MAIL_FROM || smtpUser
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
}

exports.verifyOtp = async (req, res, next) => {
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
}

exports.forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ 
        error: 'Email address is required' 
      });
    }

    const sanitizedEmail = otpUtil.sanitizeEmail(email);

    // Find user (don't reveal if user exists)
    const user = await User.findOne({ email: sanitizedEmail });

    // Always return success (prevent user enumeration attack)
    const successMessage = 'If this email is registered, you will receive password reset instructions.';

    if (!user) {
      // Log for security monitoring
      logger.warn(`Password reset requested for non-existent email: ${otpUtil.maskEmail(sanitizedEmail)}`);
      return res.json({ message: successMessage });
    }

    // Require JWT secret for secure token issuance
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      logger.error('JWT_SECRET is not set; cannot issue reset token');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    // Generate password reset token (JWT)
    // Token payload includes user ID and purpose
    const resetToken = jwt.sign(
      { 
        id: user._id, 
        purpose: 'password-reset',
        // Add timestamp to make each token unique without overriding JWT NumericDate iat
        resetIssuedAt: Date.now()
      },
      jwtSecret,
      { expiresIn: '1h' } // 1 hour expiration
    );

    // Store reset token hash in user document (for validation)
    // This allows us to invalidate the token after use
    const tokenHash = require('crypto')
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

    if (!token || !newPassword) {
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

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      logger.error('JWT_SECRET is not set; cannot validate reset token');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    // Verify JWT token
    let decoded;
    try {
      decoded = jwt.verify(token, jwtSecret);
    } catch (err) {
      return res.status(400).json({ 
        error: 'Invalid or expired reset token' 
      });
    }

    // Check token purpose
    if (decoded.purpose !== 'password-reset') {
      return res.status(400).json({ 
        error: 'Invalid token type' 
      });
    }

    // Find user
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(404).json({ 
        error: 'User not found' 
      });
    }

    // Verify token hash matches (prevents token reuse)
    const crypto = require('crypto');
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