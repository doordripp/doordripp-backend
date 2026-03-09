const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, index: true, lowercase: true },
  phone: { type: String, unique: true, sparse: true },
  phoneVerified: { type: Boolean, default: false },
  emailVerified: { type: Boolean, default: false },
  password: { type: String, required: true },
  avatar: { type: String, default: null },
  roles: { type: [String], default: ['customer'] }, // Array of roles: admin, manager, customer
  isBanned: { type: Boolean, default: false },
  banReason: { type: String, default: null },
  bannedAt: { type: Date, default: null },
  bannedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  address: {
    street: { type: String },
    city: { type: String },
    state: { type: String },
    zip: { type: String }
  },
  // Manager-specific fields
  managerFor: { type: mongoose.Schema.Types.ObjectId, ref: 'DeliveryZone', default: null },
  termsAccepted: { type: Boolean, default: false },
  blocked: { type: Boolean, default: false }, // Legacy field, use isBanned
  refreshToken: { type: String, default: null },
  // OAuth fields
  googleId: { type: String, unique: true, sparse: true },
  // Password reset fields
  resetPasswordToken: { type: String, default: null },
  resetPasswordExpires: { type: Date, default: null },
  // Trial Room fields
  lastTrialDate: { type: Date, default: null, index: true }
}, { timestamps: true })

UserSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password)
}

// Allow pre-hashed password to be set when skipPasswordHash flag is true (used for verified OTP flow)
UserSchema.pre('save', async function () {
  if (!this.isModified('password')) return
  if (this.skipPasswordHash) return
  const salt = await bcrypt.genSalt(10)
  this.password = await bcrypt.hash(this.password, salt)
})

module.exports = mongoose.models.User || mongoose.model('User', UserSchema)
