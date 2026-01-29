const mongoose = require('mongoose')

const ReviewSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  title: { type: String, required: false },
  comment: { type: String, required: true },
  
  // Helpful votes system
  helpfulVotes: { type: Number, default: 0 },
  unhelpfulVotes: { type: Number, default: 0 },
  votedUsers: [{ 
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    vote: { type: String, enum: ['helpful', 'unhelpful'] }
  }],
  
  // Verification
  isVerifiedPurchase: { type: Boolean, default: false },
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
  
  // Edit tracking
  isEdited: { type: Boolean, default: false },
  editedAt: { type: Date },
  
  // Moderation
  isApproved: { type: Boolean, default: true },
  moderatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  moderationReason: { type: String },
  
  // Additional metadata
  deviceInfo: {
    platform: String,
    browser: String
  },
  
  // Soft delete
  isDeleted: { type: Boolean, default: false },
}, { timestamps: true })

// Index for efficient queries (removed unique constraint to allow multiple reviews)
ReviewSchema.index({ product: 1, user: 1 })
ReviewSchema.index({ product: 1, createdAt: -1 })
ReviewSchema.index({ rating: -1, createdAt: -1 })
ReviewSchema.index({ helpfulVotes: -1 })
ReviewSchema.index({ isVerifiedPurchase: -1 })
ReviewSchema.index({ isApproved: 1, isDeleted: 1 })

module.exports = mongoose.models.Review || mongoose.model('Review', ReviewSchema)
