const mongoose = require('mongoose');

/**
 * Address Model
 * Stores user delivery addresses with coordinates
 */
const addressSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  // Address components
  formattedAddress: {
    type: String,
    required: true,
    trim: true
  },
  
  // Detailed address components
  addressLine1: {
    type: String,
    trim: true
  },
  
  addressLine2: {
    type: String,
    trim: true
  },
  
  city: {
    type: String,
    trim: true
  },
  
  state: {
    type: String,
    trim: true
  },
  
  postalCode: {
    type: String,
    trim: true
  },
  
  country: {
    type: String,
    trim: true
  },
  
  // Geographic coordinates
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      required: true
    }
  },
  
  // For easy access (duplicated for convenience)
  latitude: {
    type: Number,
    required: true
  },
  
  longitude: {
    type: Number,
    required: true
  },
  
  // Address label (e.g., "Home", "Work", "Other")
  label: {
    type: String,
    enum: ['Home', 'Work', 'Other'],
    default: 'Home'
  },
  
  // Is this the default delivery address?
  isDefault: {
    type: Boolean,
    default: false
  },
  
  // Additional delivery instructions
  deliveryInstructions: {
    type: String,
    trim: true
  },
  
  // Contact information for this address
  contactName: {
    type: String,
    trim: true
  },
  
  contactPhone: {
    type: String,
    trim: true
  },
  
  // Delivery zone this address belongs to
  deliveryZoneId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DeliveryZone'
  },
  
  // Is this address verified/validated?
  isVerified: {
    type: Boolean,
    default: false
  },
  
  createdAt: {
    type: Date,
    default: Date.now
  },
  
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Create geospatial index for location-based queries
addressSchema.index({ location: '2dsphere' });

// Create compound index for user queries
addressSchema.index({ userId: 1, isDefault: -1 });

// Update the updatedAt timestamp before saving
addressSchema.pre('save', async function() {
  this.updatedAt = Date.now();
  
  // If this address is set as default, unset other defaults for this user
  if (this.isDefault) {
    await this.constructor.updateMany(
      { userId: this.userId, _id: { $ne: this._id } },
      { isDefault: false }
    );
  }
});

// Virtual for getting latitude and longitude separately
addressSchema.virtual('lat').get(function() {
  return this.latitude;
});

addressSchema.virtual('lng').get(function() {
  return this.longitude;
});

// Method to format address for display
addressSchema.methods.getDisplayAddress = function() {
  if (this.formattedAddress) {
    return this.formattedAddress;
  }
  
  const parts = [];
  if (this.addressLine1) parts.push(this.addressLine1);
  if (this.addressLine2) parts.push(this.addressLine2);
  if (this.city) parts.push(this.city);
  if (this.state) parts.push(this.state);
  if (this.postalCode) parts.push(this.postalCode);
  
  return parts.join(', ');
};

module.exports = mongoose.model('Address', addressSchema);
