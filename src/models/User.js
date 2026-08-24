const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')
const { isBcryptHash } = require('../utils/password.util')

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
  phone: { type: String, unique: true, sparse: true },
  phoneVerified: { type: Boolean, default: false },
  emailVerified: { type: Boolean, default: false },
  password: { type: String, required: true },
  avatar: { type: String, default: null },
  roles: { type: [String], default: [] }, // Elevated roles; all users have implicit customer access
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
  // Delivery Partner specific fields
  deliveryPartner: {
    assignedArea: { type: mongoose.Schema.Types.ObjectId, ref: 'DeliveryZone', default: null },
    workingHours: { type: String, default: '9 AM - 5 PM' },
    maxOrdersPerSlot: { type: Number, default: 10 },
    currentLoad: { type: Number, default: 0 },
    availabilitySlots: {
      type: [String],
      enum: ['Morning 9-12', 'Afternoon 12-4', 'Evening 4-8'],
      default: ['Morning 9-12', 'Afternoon 12-4', 'Evening 4-8']
    },
    vehicleType: { type: String, default: 'Bike' }, // Bike, Scooter, Car, Van
    licenseNumber: { type: String, default: '' },
    accountNumber: { type: String, default: '' }
  },
  termsAccepted: { type: Boolean, default: false },
  blocked: { type: Boolean, default: false }, // Legacy field, use isBanned
  refreshToken: { type: String, default: null },
  isPasswordSet: { type: Boolean, default: false },
  // OAuth fields
  googleId: { type: String, unique: true, sparse: true },
  appleId: { type: String, unique: true, sparse: true },
  authProvider: { type: String, enum: ['local', 'google', 'apple'], default: 'local' },
  // Password hashing control
  skipPasswordHash: { type: Boolean, default: false },
  // Password reset fields
  resetPasswordToken: { type: String, default: null },
  resetPasswordExpires: { type: Date, default: null },
  // Trial Room fields
  lastTrialDate: { type: Date, default: null, index: true }
}, { timestamps: true })

UserSchema.methods.matchPassword = async function (enteredPassword) {
  if (!enteredPassword || !this.password) return false
  return await bcrypt.compare(enteredPassword, this.password)
}

// Allow a known pre-hashed password to be set when skipPasswordHash is true.
UserSchema.pre('save', async function () {
  if (!this.isModified('password') || !this.password) {
    if (this.skipPasswordHash) this.skipPasswordHash = false
    return;
  }

  if (this.skipPasswordHash && isBcryptHash(this.password)) {
    this.skipPasswordHash = false
    return
  }

  this.skipPasswordHash = false
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
})

// Ensure delivery partner metadata is always initialized for delivery_partner users
UserSchema.pre('save', function () {
  const hasDeliveryRole = Array.isArray(this.roles) && this.roles.includes('delivery_partner')
  if (hasDeliveryRole) {
    if (!this.deliveryPartner) {
      this.deliveryPartner = {}
    }

    // Initialize critical fields if missing
    if (typeof this.deliveryPartner.currentLoad !== 'number') {
      this.deliveryPartner.currentLoad = 0
    }
    if (typeof this.deliveryPartner.maxOrdersPerSlot !== 'number' || this.deliveryPartner.maxOrdersPerSlot <= 0) {
      this.deliveryPartner.maxOrdersPerSlot = 10
    }
    if (!this.deliveryPartner.workingHours) {
      this.deliveryPartner.workingHours = '9 AM - 5 PM'
    }
    if (!Array.isArray(this.deliveryPartner.availabilitySlots) || this.deliveryPartner.availabilitySlots.length === 0) {
      this.deliveryPartner.availabilitySlots = ['Morning 9-12', 'Afternoon 12-4', 'Evening 4-8']
    }
  }
})

module.exports = mongoose.models.User || mongoose.model('User', UserSchema)
