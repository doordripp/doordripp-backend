const mongoose = require('mongoose');

const invoiceItemSchema = new mongoose.Schema({
  // Invoice reference
  invoiceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Invoice',
    required: true,
    index: true
  },
  
  // Product details
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    // Optional - may not exist if product is deleted
  },
  productName: {
    type: String,
    required: true
  },
  productDescription: {
    type: String
  },
  
  // HSN/SAC code for GST
  hsnSac: {
    type: String,
    required: true,
    // e.g., "6109" for T-shirts, "9973" for delivery services
  },
  
  // Quantity and pricing
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  unit: {
    type: String,
    default: 'PCS',
    // PCS, KG, LTR, etc.
  },
  unitPrice: {
    type: Number,
    required: true,
    // Price per unit before GST
  },
  discount: {
    type: Number,
    default: 0
  },
  taxableValue: {
    type: Number,
    required: true,
    // (unitPrice × quantity) - discount
  },
  
  // GST details
  gstRate: {
    type: Number,
    required: true,
    // e.g., 5, 12, 18, 28
  },
  cgst: {
    type: Number,
    default: 0
  },
  cgstRate: {
    type: Number,
    default: 0
  },
  sgst: {
    type: Number,
    default: 0
  },
  sgstRate: {
    type: Number,
    default: 0
  },
  igst: {
    type: Number,
    default: 0
  },
  igstRate: {
    type: Number,
    default: 0
  },
  
  // Total
  totalPrice: {
    type: Number,
    required: true,
    // taxableValue + cgst + sgst + igst
  },
  
  // Additional metadata
  serialNumber: {
    type: Number,
    // Serial number in invoice item list
  }
}, {
  timestamps: true
});

// Indexes
invoiceItemSchema.index({ invoiceId: 1, serialNumber: 1 });

module.exports = mongoose.model('InvoiceItem', invoiceItemSchema);
