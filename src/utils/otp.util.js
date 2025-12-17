const bcrypt = require('bcryptjs');
const crypto = require('crypto');

/**
 * OTP Utility Functions
 * 
 * Handles OTP generation, hashing, and validation
 * following security best practices for e-commerce systems
 * 
 * @module OTPUtil
 */

/**
 * Generate a cryptographically secure 6-digit OTP
 * 
 * Security: Uses crypto.randomInt for true randomness
 * instead of Math.random() which is predictable
 * 
 * @returns {String} 6-digit numeric OTP
 */
function generateOTP() {
  // Generate random number between 100000 and 999999
  // crypto.randomInt is cryptographically secure (CSPRNG)
  const otp = crypto.randomInt(100000, 1000000).toString();
  return otp;
}

/**
 * Hash OTP using bcrypt before storing in database
 * 
 * Security: Never store plaintext OTPs in database
 * Bcrypt is slow by design to prevent brute force attacks
 * 
 * @param {String} otp - Plain OTP code
 * @returns {Promise<String>} Hashed OTP
 */
async function hashOTP(otp) {
  // Salt rounds: 10 is a good balance between security and performance
  // Higher = more secure but slower (2^10 = 1024 iterations)
  const saltRounds = 10;
  const hashedOTP = await bcrypt.hash(otp.toString(), saltRounds);
  return hashedOTP;
}

/**
 * Verify OTP against hashed version
 * 
 * @param {String} plainOtp - User-provided OTP
 * @param {String} hashedOtp - Stored hashed OTP from database
 * @returns {Promise<Boolean>} True if OTP matches
 */
async function verifyOTP(plainOtp, hashedOtp) {
  const isMatch = await bcrypt.compare(plainOtp.toString(), hashedOtp);
  return isMatch;
}

/**
 * Calculate OTP expiration timestamp
 * 
 * @param {Number} minutes - Expiration time in minutes (default: 5)
 * @returns {Date} Expiration timestamp
 */
function getExpirationTime(minutes = 5) {
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + minutes);
  return expiresAt;
}

/**
 * Check if OTP has expired
 * 
 * @param {Date} expiresAt - OTP expiration timestamp
 * @returns {Boolean} True if expired
 */
function isExpired(expiresAt) {
  return new Date() > new Date(expiresAt);
}

/**
 * Validate OTP format (6 digits)
 * 
 * @param {String} otp - OTP to validate
 * @returns {Boolean} True if valid format
 */
function isValidOTPFormat(otp) {
  const otpRegex = /^\d{6}$/;
  return otpRegex.test(otp);
}

/**
 * Sanitize email for storage (lowercase, trim)
 * 
 * @param {String} email - Email address
 * @returns {String} Sanitized email
 */
function sanitizeEmail(email) {
  return email.toLowerCase().trim();
}

/**
 * Calculate remaining time until OTP expires
 * 
 * @param {Date} expiresAt - OTP expiration timestamp
 * @returns {Object} Object with minutes and seconds remaining
 */
function getRemainingTime(expiresAt) {
  const now = new Date();
  const expiry = new Date(expiresAt);
  const diff = expiry - now;
  
  if (diff <= 0) {
    return { minutes: 0, seconds: 0, expired: true };
  }
  
  const minutes = Math.floor(diff / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  
  return { minutes, seconds, expired: false };
}

/**
 * Mask email for privacy (show first 2 and last 2 characters)
 * Example: john.doe@gmail.com -> jo****@gm****.com
 * 
 * @param {String} email - Email to mask
 * @returns {String} Masked email
 */
function maskEmail(email) {
  if (!email || typeof email !== 'string') return email;
  
  const [username, domain] = email.split('@');
  if (!username || !domain) return email;
  
  const maskedUsername = username.length > 4
    ? username.slice(0, 2) + '****' + username.slice(-2)
    : username.slice(0, 2) + '****';
  
  const [domainName, tld] = domain.split('.');
  const maskedDomain = domainName.length > 4
    ? domainName.slice(0, 2) + '****'
    : domainName.slice(0, 2) + '**';
  
  return `${maskedUsername}@${maskedDomain}.${tld}`;
}

module.exports = {
  generateOTP,
  hashOTP,
  verifyOTP,
  getExpirationTime,
  isExpired,
  isValidOTPFormat,
  sanitizeEmail,
  getRemainingTime,
  maskEmail
};
