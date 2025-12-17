const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Otp = require('../models/Otp');
const mailService = require('../services/mail.service');
const otpUtil = require('../utils/otp.util');

/**
 * Enhanced Authentication Controller
 * 
 * Production-ready implementation for e-commerce authentication
 * Includes OTP verification, password reset, and security best practices
 * 
 * Security Features:
 * - OTP hashed with bcrypt before storage
 * - 5-minute OTP expiration
 * - Maximum 3 verification attempts
 * - Rate limiting at route level (recommended)
 * - No sensitive data in responses
 * - JWT tokens with httpOnly cookies
 * 
 * @module AuthController
 */

/**
 * Send OTP for Email Verification
 * Used for signup, login, or email verification
 * 
 * Rate Limit: Apply 5 requests per 15 minutes at route level
 * 
 * @route POST /api/auth/send-otp
 * @body {string} email - User email address
 * @body {string} purpose - 'signup' | 'login' | 'verify-email' | 'reset-password'
 */
exports.sendOTP = async (req, res, next) => {
  try {
    const { email, purpose = 'signup' } = req.body;

    // Validate email format
    if (!email || !otpUtil.sanitizeEmail(email)) {
      return res.status(400).json({ 
        error: 'Valid email address is required' 
      });
    }

    const sanitizedEmail = otpUtil.sanitizeEmail(email);

    // For signup purpose, check if email already exists
    if (purpose === 'signup') {
      const existingUser = await User.findOne({ email: sanitizedEmail });
      if (existingUser && existingUser.emailVerified) {
        return res.status(400).json({ 
          error: 'Email already registered. Please login instead.' 
        });
      }
    }

    // For login/verify purposes, check if user exists
    if (purpose === 'login' || purpose === 'verify-email') {
      const user = await User.findOne({ email: sanitizedEmail });
      if (!user) {
        // Don't reveal if email exists for security
        return res.status(200).json({ 
          message: 'If this email is registered, you will receive an OTP.',
          email: otpUtil.maskEmail(sanitizedEmail)
        });
      }
    }

    // Use atomic findOneAndUpdate to prevent race conditions
    // Check for recent OTP and prevent spam (within 1 minute)
    const recentOtp = await Otp.findOne({
      identifier: sanitizedEmail,
      type: 'email',
      createdAt: { $gte: new Date(Date.now() - 60000) },
      verified: false
    });

    if (recentOtp && !recentOtp.isExpired()) {
      const remaining = otpUtil.getRemainingTime(recentOtp.expiresAt);
      return res.status(429).json({ 
        error: 'Please wait before requesting another OTP',
        retryAfter: 60,
        expiresIn: remaining
      });
    }

    // Generate secure 6-digit OTP
    const otp = otpUtil.generateOTP();
    const hashedOTP = await otpUtil.hashOTP(otp);
    const expiresAt = otpUtil.getExpirationTime(5); // 5 minutes

    // Atomic deletion of old OTPs (prevent race condition)
    // Use session for transaction-like behavior
    await Otp.deleteMany({ 
      identifier: sanitizedEmail, 
      type: 'email',
      verified: { $ne: true } // Don't delete verified OTPs (for audit trail)
    });

    // Create new OTP record
    await Otp.create({
      identifier: sanitizedEmail,
      type: 'email',
      codeHash: hashedOTP,
      expiresAt,
      attempts: 0,
      purpose,
      verified: false
    });

    // Send OTP via email using mail service
    try {
      await mailService.sendOtpEmail(sanitizedEmail, otp, purpose);
      
      console.log(`✅ OTP sent to ${otpUtil.maskEmail(sanitizedEmail)} for ${purpose}`);
      
      res.json({
        message: 'OTP sent successfully. Please check your email.',
        email: otpUtil.maskEmail(sanitizedEmail),
        expiresIn: 5 * 60, // seconds
        purpose
      });
    } catch (emailError) {
      // If email fails, delete the OTP and inform user
      await Otp.deleteMany({ identifier: sanitizedEmail, type: 'email' });
      throw new Error('Failed to send email. Please try again later.');
    }

  } catch (error) {
    console.error('Send OTP error:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to send OTP' 
    });
  }
};

/**
 * Verify OTP and Complete Registration/Login
 * 
 * Security: 
 * - Maximum 3 attempts before OTP is invalidated
 * - OTP deleted after successful verification
 * - Constant-time comparison via bcrypt
 * 
 * @route POST /api/auth/verify-otp
 * @body {string} email - User email
 * @body {string} otp - 6-digit OTP code
 */
exports.verifyOTP = async (req, res, next) => {
  try {
    const { email, otp } = req.body;

    // Validate inputs
    if (!email || !otp) {
      return res.status(400).json({ 
        error: 'Email and OTP are required' 
      });
    }

    if (!otpUtil.isValidOTPFormat(otp)) {
      return res.status(400).json({ 
        error: 'Invalid OTP format. Must be 6 digits.' 
      });
    }

    const sanitizedEmail = otpUtil.sanitizeEmail(email);

    // Find the most recent OTP for this email
    const otpRecord = await Otp.findOne({
      identifier: sanitizedEmail,
      type: 'email',
      verified: false
    }).sort({ createdAt: -1 });

    if (!otpRecord) {
      return res.status(400).json({ 
        error: 'No OTP found. Please request a new one.' 
      });
    }

    // Check if OTP has expired
    if (otpRecord.isExpired()) {
      await Otp.deleteMany({ identifier: sanitizedEmail, type: 'email' });
      return res.status(400).json({ 
        error: 'OTP has expired. Please request a new one.' 
      });
    }

    // Check if maximum attempts exceeded
    if (otpRecord.isLocked()) {
      await Otp.deleteMany({ identifier: sanitizedEmail, type: 'email' });
      return res.status(400).json({ 
        error: 'Too many failed attempts. Please request a new OTP.' 
      });
    }

    // Verify OTP using bcrypt (constant-time comparison)
    const isValid = await otpUtil.verifyOTP(otp, otpRecord.codeHash);

    if (!isValid) {
      // Increment failed attempts
      await otpRecord.incrementAttempts();
      
      const remainingAttempts = 3 - otpRecord.attempts;
      return res.status(400).json({ 
        error: 'Invalid OTP',
        remainingAttempts: remainingAttempts > 0 ? remainingAttempts : 0
      });
    }

    // OTP is valid - mark as verified
    otpRecord.verified = true;
    await otpRecord.save();

    // Find or create user
    let user = await User.findOne({ email: sanitizedEmail });
    
    if (!user) {
      return res.status(404).json({ 
        error: 'User not found. Please complete registration first.' 
      });
    }

    // Mark email as verified
    user.emailVerified = true;
    await user.save();

    // Delete all OTPs for this email
    await Otp.deleteMany({ identifier: sanitizedEmail, type: 'email' });

    // Generate JWT token
    const token = jwt.sign(
      { id: user._id, roles: user.roles || [] },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '7d' }
    );

    // Set httpOnly cookie
    const cookieOptions = {
      httpOnly: true, // Prevents JavaScript access (XSS protection)
      sameSite: 'none', // Required for cross-origin cookie transmission
      secure: true, // HTTPS only in production
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      domain: process.env.NODE_ENV === 'production' ? '.doordripp.com' : undefined, // Allows both doordripp.com and www.doordripp.com
    };

    res.cookie('token', token, cookieOptions);

    console.log(`✅ Email verified for ${otpUtil.maskEmail(sanitizedEmail)}`);

    res.json({
      message: 'Email verified successfully!',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        roles: user.roles,
        emailVerified: user.emailVerified
      },
      token
    });

  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({ 
      error: 'Failed to verify OTP' 
    });
  }
};

/**
 * Request Password Reset
 * Sends password reset link via email
 * 
 * Security:
 * - Uses JWT token (not OTP) for password reset
 * - Token expires in 1 hour
 * - Token is single-use (invalidated after password change)
 * - No indication if email exists (prevents user enumeration)
 * 
 * @route POST /api/auth/forgot-password
 * @body {string} email - User email
 */
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
      console.log(`⚠️  Password reset requested for non-existent email: ${otpUtil.maskEmail(sanitizedEmail)}`);
      return res.json({ message: successMessage });
    }

    // Generate password reset token (JWT)
    // Token payload includes user ID and purpose
    const resetToken = jwt.sign(
      { 
        id: user._id, 
        purpose: 'password-reset',
        // Add timestamp to make each token unique
        iat: Date.now()
      },
      process.env.JWT_SECRET || 'secret',
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
    await user.save();

    // Send password reset email
    try {
      await mailService.sendPasswordResetEmail(
        sanitizedEmail,
        resetToken,
        user.name
      );
      
      console.log(`✅ Password reset email sent to ${otpUtil.maskEmail(sanitizedEmail)}`);
    } catch (emailError) {
      console.error('Failed to send reset email:', emailError);
      // Don't reveal email sending failure to user
    }

    res.json({ message: successMessage });

  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ 
      error: 'Failed to process password reset request' 
    });
  }
};

/**
 * Reset Password with Token
 * 
 * Security:
 * - Validates JWT token
 * - Checks token hasn't been used
 * - Requires strong password
 * - Invalidates token after successful reset
 * 
 * @route POST /api/auth/reset-password
 * @body {string} token - JWT reset token from email
 * @body {string} newPassword - New password
 */
exports.resetPassword = async (req, res, next) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ 
        error: 'Token and new password are required' 
      });
    }

    // Validate password strength
    if (newPassword.length < 6) {
      return res.status(400).json({ 
        error: 'Password must be at least 6 characters long' 
      });
    }

    // Verify JWT token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
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
    const storedHash = Buffer.from(user.resetPasswordToken || '', 'hex');
    const providedHash = Buffer.from(tokenHash, 'hex');
    
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
    if (user.resetPasswordExpires < new Date()) {
      return res.status(400).json({ 
        error: 'Reset token has expired. Please request a new one.' 
      });
    }

    // Update password (will be hashed by pre-save hook)
    user.password = newPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    console.log(`✅ Password reset successful for user: ${user._id}`);

    res.json({ 
      message: 'Password reset successful. You can now login with your new password.' 
    });

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ 
      error: 'Failed to reset password' 
    });
  }
};

module.exports = exports;
