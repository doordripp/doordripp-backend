const mongoose = require('mongoose')

const ProductSchema = new mongoose.Schema({
  name: { type: String, required: true },
  slug: { type: String, required: true, unique: true, index: true },
  description: { type: String },
  price: { type: Number, required: true },
  stock: { type: Number, default: 0 },
  images: { type: [String], default: [] },
  category: { type: String },
}, { timestamps: true })

module.exports = mongoose.models.Product || mongoose.model('Product', ProductSchema)
// Deprecated Mongoose model placeholder.
// This project was migrated to Prisma/SQL. Use `src/config/prisma.js` and the Prisma client instead.
// If you still need the Mongoose model for compatibility, restore it manually.

module.exports = null;
