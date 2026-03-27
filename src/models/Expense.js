const mongoose = require('mongoose');

const ExpenseSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['marketing', 'operational', 'logistics', 'platform', 'personnel', 'other'],
      required: true,
      index: true
    },
    category: {
      type: String,
      required: true
    },
    amount: {
      type: Number,
      required: true,
      min: 0
    },
    currency: {
      type: String,
      default: 'INR'
    },
    description: String,
    campaign: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Campaign'
    },
    vendor: String,
    invoiceNum: String,
    status: {
      type: String,
      enum: ['pending', 'approved', 'paid', 'rejected'],
      default: 'pending',
      index: true
    },
    date: {
      type: Date,
      required: true,
      index: true
    },
    month: {
      // For efficient aggregation
      type: String,
      default: function () {
        const now = this.date || new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      },
      index: true
    },
    attachments: [String], // URLs to invoice files
    notes: String,
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  { timestamps: true }
);

// Indexes for performance
ExpenseSchema.index({ type: 1, date: -1 });
ExpenseSchema.index({ status: 1, date: -1 });
ExpenseSchema.index({ month: 1 });

module.exports = mongoose.model('Expense', ExpenseSchema);
