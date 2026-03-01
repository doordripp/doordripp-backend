const mongoose = require('mongoose')

const CategorySchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  slug: { type: String, required: true, unique: true },
  imageUrl: { type: String, required: true },
  imageKitId: { type: String },
  description: { type: String },
  isActive: { type: Boolean, default: true },
  order: { type: Number, default: 0 }
}, { timestamps: true })

module.exports = mongoose.models.Category || mongoose.model('Category', CategorySchema)
