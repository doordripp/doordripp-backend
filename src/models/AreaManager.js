const mongoose = require('mongoose')

const AreaManagerSchema = new mongoose.Schema({
  manager: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true,
    index: true
  },
  deliveryZone: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'DeliveryZone', 
    required: true,
    index: true
  },
  status: { 
    type: String, 
    enum: ['active', 'inactive', 'suspended'],
    default: 'active'
  },
  assignedBy: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User',
    required: true
  },
  assignedAt: { 
    type: Date, 
    default: Date.now 
  },
  performance: {
    totalOrdersHandled: { type: Number, default: 0 },
    averageRating: { type: Number, default: 0 },
    totalCustomersServed: { type: Number, default: 0 }
  },
  notes: { type: String, default: null }
}, { timestamps: true })

// Ensure one manager per zone
AreaManagerSchema.index({ manager: 1, deliveryZone: 1 }, { unique: true })

module.exports = mongoose.models.AreaManager || mongoose.model('AreaManager', AreaManagerSchema)
