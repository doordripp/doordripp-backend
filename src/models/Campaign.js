const mongoose = require('mongoose');

const CampaignSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    description: String,
    source: {
      type: String,
      enum: ['facebook', 'google', 'instagram', 'email', 'sms', 'affiliate', 'organic', 'direct', 'other'],
      required: true,
      index: true
    },
    budget: {
      type: Number,
      required: true,
      min: 0
    },
    actualSpend: {
      type: Number,
      default: 0,
      min: 0
    },
    status: {
      type: String,
      enum: ['planning', 'active', 'paused', 'completed', 'cancelled'],
      default: 'active',
      index: true
    },
    startDate: {
      type: Date,
      required: true,
      index: true
    },
    endDate: {
      type: Date,
      required: true,
      index: true
    },
    targetAudience: {
      description: String,
      estimatedReach: Number,
      demographics: mongoose.Schema.Types.Mixed
    },
    metrics: {
      impressions: { type: Number, default: 0 },
      clicks: { type: Number, default: 0 },
      conversions: { type: Number, default: 0 },
      revenue: { type: Number, default: 0 }
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  { timestamps: true }
);

// Indexes for performance
CampaignSchema.index({ startDate: 1, endDate: 1 });
CampaignSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Campaign', CampaignSchema);
