const mongoose = require('mongoose')

const SaleCampaignSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true, index: true },
  description: { type: String, default: '' },
  startTime: { type: Date, required: true, index: true },
  endTime: { type: Date, required: true, index: true },
  isActive: { type: Boolean, default: true, index: true },
  applyTo: { type: String, enum: ['all', 'category', 'products'], default: 'all', index: true },
  category: { type: String, default: '', index: true },
  productIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
  priority: { type: Number, default: 0 },
  allowOverlap: { type: Boolean, default: false },
  notes: { type: String, default: '' }
}, { timestamps: true })

SaleCampaignSchema.index({ startTime: 1, endTime: 1 })

module.exports = mongoose.models.SaleCampaign || mongoose.model('SaleCampaign', SaleCampaignSchema)
