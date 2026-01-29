const mongoose = require('mongoose')

const ReviewSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  title: { type: String, default: '' },
  comment: { type: String, default: '' },
}, { timestamps: true })

// Ensure one review per user per product
ReviewSchema.index({ product: 1, user: 1 }, { unique: true })

module.exports = mongoose.models.Review || mongoose.model('Review', ReviewSchema)
