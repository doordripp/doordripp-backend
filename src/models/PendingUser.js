const mongoose = require('mongoose');

const PendingUserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
  name: { type: String, required: true },
  passwordHash: { type: String, required: true },
  otpHash: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  attempts: { type: Number, default: 0 },
  // Optional fields captured during signup
  phone: { type: String },
}, { timestamps: true });

// TTL index to auto-clean expired pending users
PendingUserSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.PendingUser || mongoose.model('PendingUser', PendingUserSchema);
