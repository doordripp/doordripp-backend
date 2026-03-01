const mongoose = require('mongoose')

const BannerSchema = new mongoose.Schema({
  title: { type: String, default: 'Promo Banner' },
  imageUrl: { type: String, required: true },
  imageKitId: { type: String }, // To handle deletions later
  link: { type: String, default: '#' }, // URL redirection link
  isActive: { type: Boolean, default: true },
  type: { type: String, default: 'promo' }, // 'hero', 'promo', etc.
  order: { type: Number, default: 0 } // For sorting banners
}, { timestamps: true })

module.exports = mongoose.models.Banner || mongoose.model('Banner', BannerSchema)
