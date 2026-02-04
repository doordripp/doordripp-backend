const mongoose = require('mongoose');

const invoiceSchema = new mongoose.Schema({
  // Invoice identification
  invoiceNumber: {
    type: String,
    required: true,
    unique: true,
    index: true,
    // Format: DD/2025-26/000123
  },
  invoiceDate: {
    type: Date,
    required: true,
    default: Date.now
  },
  financialYear: {
    type: String,
    required: true,
    // e.g., "2025-26"
  },
  
  // Order reference
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true,
    unique: true, // One invoice per order
    index: true
  },
  
  // Seller (DoorDripp) details
  sellerName: {
    type: String,
    required: true,
    default: 'DoorDripp'
  },
  sellerGSTIN: {
    type: String,
    required: true,
    // Should be set from env or config
  },
  sellerAddress: {
    line1: String,
    line2: String,
    city: String,
    state: String,
    pincode: String,
    country: { type: String, default: 'India' }
  },
  sellerStateCode: {
    type: String,
    required: true,
    // e.g., "07" for Delhi, "27" for Maharashtra
  },
  sellerPAN: {
    type: String
  },
  sellerEmail: {
    type: String
  },
  sellerPhone: {
    type: String
  },
  
  // Buyer details
  buyerName: {
    type: String,
    required: true
  },
  buyerEmail: {
    type: String
  },
  buyerPhone: {
    type: String
  },
  buyerAddress: {
    line1: String,
    line2: String,
    city: String,
    state: String,
    pincode: String,
    country: { type: String, default: 'India' }
  },
  buyerGSTIN: {
    type: String,
    // Optional - for B2B customers
  },
  buyerStateCode: {
    type: String,
    required: true
  },
  placeOfSupply: {
    type: String,
    required: true,
    // State name, e.g., "Maharashtra"
  },
  
  // Financial details
  taxableAmount: {
    type: Number,
    required: true,
    // Total before GST
  },
  cgstAmount: {
    type: Number,
    default: 0
  },
  sgstAmount: {
    type: Number,
    default: 0
  },
  igstAmount: {
    type: Number,
    default: 0
  },
  totalAmount: {
    type: Number,
    required: true,
    // Final invoice amount (taxableAmount + GST)
  },
  roundOffAmount: {
    type: Number,
    default: 0
  },
  
  // Payment details
  paymentMode: {
    type: String,
    enum: ['online', 'cod', 'upi', 'card', 'netbanking'],
    required: true
  },
  paymentStatus: {
    type: String,
    enum: ['paid', 'pending', 'cod'],
    default: 'paid'
  },
  
  // Invoice metadata
  invoiceType: {
    type: String,
    enum: ['tax_invoice', 'credit_note', 'debit_note'],
    default: 'tax_invoice'
  },
  invoicePdfUrl: {
    type: String,
    // S3 or local file path
  },
  invoicePdfPath: {
    type: String,
    // Server file path
  },
  
  // Status
  status: {
    type: String,
    enum: ['draft', 'generated', 'sent', 'cancelled'],
    default: 'generated'
  },
  
  // Notes
  notes: {
    type: String
  },
  termsAndConditions: {
    type: String
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
invoiceSchema.index({ financialYear: 1, invoiceNumber: 1 });
invoiceSchema.index({ invoiceDate: -1 });
invoiceSchema.index({ orderId: 1 });

// Static method to generate next invoice number
invoiceSchema.statics.generateNextInvoiceNumber = async function(financialYear) {
  const prefix = 'DD';
  
  // Find the last invoice for this financial year
  const lastInvoice = await this.findOne({ financialYear })
    .sort({ invoiceNumber: -1 })
    .limit(1);
  
  let sequenceNumber = 1;
  
  if (lastInvoice && lastInvoice.invoiceNumber) {
    // Extract sequence number from format: DD/2025-26/000123
    const parts = lastInvoice.invoiceNumber.split('/');
    if (parts.length === 3) {
      const lastSeq = parseInt(parts[2], 10);
      if (!isNaN(lastSeq)) {
        sequenceNumber = lastSeq + 1;
      }
    }
  }
  
  // Format: DD/2025-26/000123 (6 digits, zero-padded)
  const paddedSeq = String(sequenceNumber).padStart(6, '0');
  return `${prefix}/${financialYear}/${paddedSeq}`;
};

// Method to get financial year from date
invoiceSchema.statics.getFinancialYear = function(date = new Date()) {
  const year = date.getFullYear();
  const month = date.getMonth(); // 0-indexed
  
  // Financial year in India: April to March
  if (month >= 3) { // April onwards (month 3 = April)
    return `${year}-${String(year + 1).slice(-2)}`;
  } else {
    return `${year - 1}-${String(year).slice(-2)}`;
  }
};

module.exports = mongoose.model('Invoice', invoiceSchema);
