const mongoose = require('mongoose')

const OtpSchema = new mongoose.Schema({
  identifier: { type: String, required: true, index: true }, // phone number or email
  type: { type: String, enum: ['phone', 'email'], required: true },
  codeHash: { type: String, required: true },
  expiresAt: { type: Date, required: true }
}, { timestamps: true })

module.exports = mongoose.models.Otp || mongoose.model('Otp', OtpSchema)
