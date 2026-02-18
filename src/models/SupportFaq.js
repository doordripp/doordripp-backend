const mongoose = require('mongoose')

const SupportFaqSchema = new mongoose.Schema({
  question: { type: String, required: true, trim: true },
  answer: { type: String, required: true, trim: true },
  language: { type: String, default: 'en', index: true },
  category: { type: String, default: 'general' },
  tags: { type: [String], default: [] },
  quickReplies: { type: [String], default: [] },
  isActive: { type: Boolean, default: true }
}, { timestamps: true })

SupportFaqSchema.index({ question: 'text', answer: 'text', tags: 'text' })

module.exports = mongoose.models.SupportFaq || mongoose.model('SupportFaq', SupportFaqSchema)
