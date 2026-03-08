const mongoose = require('mongoose')

const voucherUsageSchema = new mongoose.Schema({
  voucher: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Voucher',
    required: true,
    index: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  count: {
    type: Number,
    default: 0,
    min: 0
  }
}, { timestamps: true })

voucherUsageSchema.index({ voucher: 1, user: 1 }, { unique: true })

module.exports = mongoose.models.VoucherUsage || mongoose.model('VoucherUsage', voucherUsageSchema)
