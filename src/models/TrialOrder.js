/**
 * TrialOrder Model
 * 
 * Represents a trial room order in the system.
 * Users can select 1-3 items to trial and must purchase at least 1 item.
 * 
 * Business Rules:
 * - Max 3 items for trial
 * - Must purchase at least 1 item from selected items
 * - ₹200 trial fee per order
 * - One trial per day per user
 * 
 * @schema TrialOrder
 */

const mongoose = require('mongoose');

/**
 * Trial Item Schema - Items selected for trial
 * Each item tracks which product was trialed
 */
const TrialItemSchema = new mongoose.Schema({
  product: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Product',
    required: true 
  },
  name: { 
    type: String, 
    required: true 
  },
  price: { 
    type: Number, 
    required: true 
  },
  image: { 
    type: String 
  },
  quantity: { 
    type: Number, 
    default: 1 
  }
}, { _id: true });

/**
 * TrialOrder Main Schema
 */
const TrialOrderSchema = new mongoose.Schema({
  // Reference to the user who created the trial order
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  // Array of items selected for trial (max 3)
  trialItems: {
    type: [TrialItemSchema],
    required: true,
    validate: {
      validator: function(items) {
        return items && items.length > 0 && items.length <= 3;
      },
      message: 'Trial items must be between 1 and 3'
    }
  },

  // The product ID that user purchased from trial items
  purchasedItemId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },

  // Price calculations
  itemsTotal: {
    type: Number,
    required: true,
    min: 0
  },

  // Fixed trial fee per order
  trialFee: {
    type: Number,
    default: 200,
    immutable: true
  },

  // Final total including trial fee
  finalTotal: {
    type: Number,
    required: true,
    min: 0
  },

  /**
   * Status tracking
   * - trial_created: Initial state, trial room is created
   * - trial_abandoned: User didn't complete purchase
   * - converted_to_order: Trial was converted to actual order
   * - cancelled: Trial was cancelled
   */
  status: {
    type: String,
    enum: ['trial_created', 'trial_abandoned', 'converted_to_order', 'cancelled'],
    default: 'trial_created',
    index: true
  },

  // Link to the actual order created from this trial (if converted)
  linkedOrderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    default: null
  },

  // Metadata
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },

  updatedAt: {
    type: Date,
    default: Date.now,
    index: true
  },

  // For analytics
  convertedAt: {
    type: Date,
    default: null
  }
}, { timestamps: true });

/**
 * Indexes for performance optimization
 */
TrialOrderSchema.index({ userId: 1, createdAt: -1 });
TrialOrderSchema.index({ status: 1, createdAt: -1 });
TrialOrderSchema.index({ purchasedItemId: 1 });

/**
 * Virtual method to get trial date
 */
TrialOrderSchema.virtual('trialDate').get(function() {
  return this.createdAt.toISOString().split('T')[0];
});

/**
 * Static method to check if user used trial today
 * @param {ObjectId} userId - The user ID
 * @returns {Promise<boolean>} True if user has used trial today
 */
TrialOrderSchema.statics.hasUsedTrialToday = async function(userId) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const count = await this.countDocuments({
    userId,
    createdAt: {
      $gte: today,
      $lt: tomorrow
    },
    status: { $ne: 'cancelled' }
  });

  return count > 0;
};

/**
 * Instance method to convert trial to actual order
 * @returns {Promise<Object>} Updated trial order
 */
TrialOrderSchema.methods.convertToOrder = async function(orderId) {
  this.status = 'converted_to_order';
  this.linkedOrderId = orderId;
  this.convertedAt = new Date();
  return await this.save();
};

/**
 * Instance method to cancel trial
 * @returns {Promise<Object>} Updated trial order
 */
TrialOrderSchema.methods.cancel = async function() {
  if (this.status === 'converted_to_order') {
    throw new Error('Cannot cancel trial that has been converted to order');
  }
  this.status = 'cancelled';
  return await this.save();
};

/**
 * Pre-save hook to validate purchased item is in trial items
 */
TrialOrderSchema.pre('save', async function() {
  // Validate purchased item is in trial items
  const purchasedItemInTrial = this.trialItems.some(
    item => item.product.toString() === this.purchasedItemId.toString()
  );

  if (!purchasedItemInTrial) {
    throw new Error('Purchased item must be one of the trial items');
  }
});

/**
 * Pre-save hook to calculate finalTotal
 */
TrialOrderSchema.pre('save', function() {
  if (!this.isModified('itemsTotal') && !this.isModified('trialFee')) {
    return;
  }

  this.finalTotal = this.itemsTotal + this.trialFee;
});

module.exports = mongoose.models.TrialOrder || mongoose.model('TrialOrder', TrialOrderSchema);
