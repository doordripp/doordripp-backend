const mongoose = require('mongoose');

const TrafficSourceSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    source: {
      type: String,
      enum: ['organic', 'paid', 'direct', 'referral', 'social', 'email', 'sms'],
      required: true,
      index: true
    },
    campaign: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Campaign'
    },
    referrer: String,
    userAgent: String,
    ipAddress: String,
    deviceType: {
      type: String,
      enum: ['mobile', 'tablet', 'desktop'],
      default: 'desktop'
    },
    sessionId: String,
    sessionDuration: Number, // in seconds
    pageViews: {
      type: Number,
      default: 1
    },
    actions: {
      productViewed: { type: Boolean, default: false },
      addedToCart: { type: Boolean, default: false },
      initiatedCheckout: { type: Boolean, default: false },
      completed: { type: Boolean, default: false },
      conversionValue: { type: Number, default: 0 }
    },
    metadata: mongoose.Schema.Types.Mixed
  },
  { timestamps: true }
);

// Indexes for performance
TrafficSourceSchema.index({ user: 1, createdAt: -1 });
TrafficSourceSchema.index({ source: 1, createdAt: -1 });
TrafficSourceSchema.index({ campaign: 1, createdAt: -1 });
TrafficSourceSchema.index({ 'actions.completed': 1 });

module.exports = mongoose.model('TrafficSource', TrafficSourceSchema);
