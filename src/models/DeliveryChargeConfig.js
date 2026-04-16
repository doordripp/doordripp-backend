const mongoose = require('mongoose');

const deliveryOptionSchema = new mongoose.Schema({
  id: {
    type: String,
    enum: ['regular', 'standard', 'priority'],
    required: true
  },
  label: {
    type: String,
    required: true,
    trim: true
  },
  sublabel: {
    type: String,
    trim: true,
    default: ''
  },
  eta: {
    type: String,
    required: true,
    trim: true
  },
  charge: {
    type: Number,
    required: true,
    min: 0
  },
  badge: {
    type: String,
    trim: true,
    default: ''
  },
  isActive: {
    type: Boolean,
    default: true
  },
  sortOrder: {
    type: Number,
    default: 0
  }
}, { _id: false });

const deliveryChargeConfigSchema = new mongoose.Schema({
  key: {
    type: String,
    unique: true,
    default: 'default'
  },
  defaultDeliveryType: {
    type: String,
    enum: ['regular', 'standard', 'priority'],
    default: 'regular'
  },
  options: {
    type: [deliveryOptionSchema],
    default: []
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, { timestamps: true });

module.exports = mongoose.model('DeliveryChargeConfig', deliveryChargeConfigSchema);
