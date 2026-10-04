const mongoose = require('mongoose')

/**
 * Denylist of session tokens revoked before their natural expiry (logout).
 * Only the SHA-256 of the token is stored. Entries remove themselves once the
 * token would have expired anyway.
 */
const RevokedTokenSchema = new mongoose.Schema({
  tokenHash: { type: String, required: true, unique: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  expiresAt: { type: Date, required: true }
}, { timestamps: true })

RevokedTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

module.exports = mongoose.models.RevokedToken || mongoose.model('RevokedToken', RevokedTokenSchema)
