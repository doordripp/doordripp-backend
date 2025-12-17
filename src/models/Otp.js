const mongoose = require('mongoose')

/**
 * OTP Model for Email and Phone Verification
 * 
 * Security Features:
 * - OTP is hashed using bcrypt before storage (never store plaintext OTP)
 * - 5-minute expiration to limit attack window
 * - Maximum 3 verification attempts to prevent brute force
 * - Automatic cleanup of expired OTPs via TTL index
 * 
 * @property {String} identifier - Email or phone number
 * @property {String} type - 'email' or 'phone'
 * @property {String} codeHash - Bcrypt hashed OTP (never plaintext)
 * @property {Date} expiresAt - OTP expiration timestamp
 * @property {Number} attempts - Failed verification attempts counter
 * @property {String} purpose - Reason for OTP (signup, login, reset-password)
 */
const OtpSchema = new mongoose.Schema({
  identifier: { 
    type: String, 
    required: true, 
    index: true,
    lowercase: true,
    trim: true
  },
  type: { 
    type: String, 
    enum: ['phone', 'email'], 
    required: true 
  },
  codeHash: { 
    type: String, 
    required: true 
  },
  expiresAt: { 
    type: Date, 
    required: true
    // Note: TTL index defined separately below
  },
  attempts: {
    type: Number,
    default: 0,
    max: 3 // Maximum 3 failed attempts before OTP becomes invalid
  },
  purpose: {
    type: String,
    enum: ['signup', 'login', 'reset-password', 'verify-email'],
    default: 'signup'
  },
  verified: {
    type: Boolean,
    default: false
  }
}, { 
  timestamps: true 
})

// Compound indexes for efficient lookups and better query performance
// Primary lookup index for finding active OTPs
OtpSchema.index({ identifier: 1, type: 1, verified: 1 })

// Index for spam check queries (recent OTP lookup)
OtpSchema.index({ identifier: 1, createdAt: -1 })

// TTL index: Automatically delete documents 10 minutes after expiresAt
// This keeps the database clean and prevents orphaned OTP records
OtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 600 })

// Sparse index for verified OTPs (audit trail)
OtpSchema.index({ verified: 1, createdAt: -1 }, { sparse: true })

/**
 * Check if OTP has expired
 */
OtpSchema.methods.isExpired = function() {
  return new Date() > this.expiresAt
}

/**
 * Check if OTP has exceeded maximum attempts
 */
OtpSchema.methods.isLocked = function() {
  return this.attempts >= 3
}

/**
 * Increment failed verification attempts
 */
OtpSchema.methods.incrementAttempts = async function() {
  this.attempts += 1
  await this.save()
}

module.exports = mongoose.models.Otp || mongoose.model('Otp', OtpSchema)
