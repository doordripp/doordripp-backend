const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, index: true },
  phone: { type: String, unique: true, sparse: true },
  phoneVerified: { type: Boolean, default: false },
  emailVerified: { type: Boolean, default: false },
  password: { type: String, required: true },
  avatar: { type: String, default: null },
  roles: { type: [String], default: [] },
  gender: { type: String, enum: ['male', 'female', 'other'], default: null },
  dob: { type: Date, default: null },
  address: {
    street: { type: String },
    city: { type: String },
    state: { type: String },
    zip: { type: String }
  },
  termsAccepted: { type: Boolean, default: false },
  blocked: { type: Boolean, default: false },
  refreshToken: { type: String, default: null },
  // OAuth fields
  googleId: { type: String, unique: true, sparse: true },
  // Password reset fields
  resetPasswordToken: { type: String, default: null },
  resetPasswordExpires: { type: Date, default: null }
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
