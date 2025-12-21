const mongoose = require('mongoose')

const WishlistSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  items: [
    {
      product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true
      },
      name: String,
      image: String,
      price: Number,
      originalPrice: Number,
      discount: Number,
      category: String,
      addedAt: { type: Date, default: Date.now }
    }
  ]
}, { timestamps: true })

// Index to ensure one wishlist per user
WishlistSchema.index({ user: 1 }, { unique: true })

module.exports = mongoose.models.Wishlist || mongoose.model('Wishlist', WishlistSchema)
