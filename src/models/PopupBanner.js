const mongoose = require('mongoose')

const PopupBannerSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  imageUrl: { type: String, default: '' },
  startTime: { type: Date, required: true, index: true },
  endTime: { type: Date, required: true, index: true },
  isActive: { type: Boolean, default: true, index: true },
  saleCampaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'SaleCampaign', default: null, index: true },
  priority: { type: Number, default: 0, index: true },
  buttonText: { type: String, default: 'Shop Now' },
  customLink: { type: String, default: '' },
  closeOnOutsideClick: { type: Boolean, default: true }
}, { timestamps: true })

PopupBannerSchema.index({ startTime: 1, endTime: 1, priority: -1 })

module.exports = mongoose.models.PopupBanner || mongoose.model('PopupBanner', PopupBannerSchema)
