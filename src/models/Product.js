const mongoose = require('mongoose')

const ProductSchema = new mongoose.Schema({
  name: { type: String, required: true },
  slug: { type: String, required: true, unique: true, index: true },
  description: { type: String },
  price: { type: Number, required: true },
  originalPrice: { type: Number },
  discount: { type: Number },
  stock: { type: Number, default: 0 },
  reserved: { type: Number, default: 0 },
  images: { type: [String], default: [] },
  category: { type: String },
  subcategory: { type: String },
  colors: { type: [String], default: [] },
  sizes: { type: [String], default: [] },
  rating: {
    rating: { type: Number, default: 4.5 },
    reviews: { type: Number, default: 0 }
  },
  // Collection flags for categorization
  isNewArrival: { type: Boolean, default: false },
  isBestSeller: { type: Boolean, default: false },
  isFeatured: { type: Boolean, default: false },
  status: { type: String, default: 'Active' }
}, { timestamps: true })

module.exports = mongoose.models.Product || mongoose.model('Product', ProductSchema)
