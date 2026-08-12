const mongoose = require('mongoose')
const { normalizeSizeInventory, getTotalStock } = require('../utils/productInventory')

const SizeInventorySchema = new mongoose.Schema({
  size: { type: String, required: true, trim: true },
  stock: { type: Number, default: 0, min: 0 }
}, { _id: false })

const ProductSchema = new mongoose.Schema({
  name: { type: String, required: true },
  slug: { type: String, required: true, unique: true, index: true },
  description: { type: String },
  price: { type: Number, required: true },
  originalPrice: { type: Number },
  discount: { type: Number },
  costPrice: { type: Number },
  deliveryCost: { type: Number, default: 60 },
  pricingMode: { type: String, enum: ['auto', 'manual'], default: 'auto' },
  stock: { type: Number, default: 0 },
  reserved: { type: Number, default: 0 },
  images: { type: [String], default: [] },
  category: { type: String },
  subcategory: { type: String },
  colors: { type: [String], default: [] },
  sizes: { type: [String], default: [] },
  sizeInventory: { type: [SizeInventorySchema], default: [] },
  rating: {
    rating: { type: Number, default: 4.5 },
    reviews: { type: Number, default: 0 }
  },
  // Collection flags for categorization
  isNewArrival: { type: Boolean, default: false },
  isBestSeller: { type: Boolean, default: false },
  isFeatured: { type: Boolean, default: false },
  status: { type: String, default: 'Active' },
  
  // Key Features (bullet points)
  keyFeatures: { type: [String], default: [] },

  // Admin-curated search tags for improved discoverability
  searchTags: { type: [String], default: [] },

  // Dynamic Specifications
  details: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {}
  },
  
  // GST-related fields for invoice generation
  hsnSac: { 
    type: String, 
    default: '9973',
    comment: 'HSN/SAC code for GST compliance'
  },
  gstRate: { 
    type: Number, 
    default: 0,
    min: 0,
    max: 28,
    comment: 'GST rate in percentage (0, 5, 12, 18, 28)'
  },
  productSource: { 
    type: String, 
    enum: ['Retailer', 'Manufacturer'], 
    default: 'Manufacturer',
    index: true
  },
  listedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true
  }
}, { timestamps: true })

ProductSchema.index({ status: 1, isNewArrival: -1, createdAt: -1 })
ProductSchema.index({ status: 1, isBestSeller: -1, createdAt: -1 })
ProductSchema.index({ status: 1, isFeatured: -1, createdAt: -1 })
ProductSchema.index({ status: 1, category: 1, createdAt: -1 })

// Compound text index for full-text search with field weights
ProductSchema.index(
  {
    name: 'text',
    category: 'text',
    subcategory: 'text',
    keyFeatures: 'text',
    description: 'text',
    searchTags: 'text'
  },
  {
    weights: { name: 10, category: 5, subcategory: 5, keyFeatures: 3, description: 1, searchTags: 4 },
    name: 'product_search_index',
    default_language: 'english'
  }
)

ProductSchema.pre('validate', function syncSizeInventory() {
  const normalizedInventory = normalizeSizeInventory(this.sizeInventory, this.sizes, this.stock)
  this.sizeInventory = normalizedInventory
  this.sizes = normalizedInventory.map((entry) => entry.size)
  this.stock = getTotalStock(normalizedInventory)
})

module.exports = mongoose.models.Product || mongoose.model('Product', ProductSchema)
