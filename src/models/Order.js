const mongoose = require('mongoose')

const OrderItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  name: { type: String, required: true },
  quantity: { type: Number, required: true },
  size: { type: String, default: 'M' },
  price: { type: Number, required: true },
  image: { type: String },
  // GST Details per item
  gstRate: { type: Number, default: 0 }, // 5, 12, 18, 28, etc.
  cgst: { type: Number, default: 0 },
  sgst: { type: Number, default: 0 },
  igst: { type: Number, default: 0 },
  productSource: { type: String, enum: ['Retailer', 'Manufacturer'], default: 'Manufacturer' },
  itemTotal: { type: Number } // price * quantity + GST
})

const OrderSchema = new mongoose.Schema({
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  items: [OrderItemSchema],

  // Financial Breakdown
  subtotal: { type: Number, required: true }, // Sum of (price * quantity) before GST
  cgstTotal: { type: Number, default: 0 }, // Total CGST for all items
  sgstTotal: { type: Number, default: 0 }, // Total SGST for all items
  igstTotal: { type: Number, default: 0 }, // Total IGST for all items
  totalGST: { type: Number, default: 0 }, // Total GST (CGST+SGST or IGST)
  deliveryFee: { type: Number, default: 0 },
  trialFee: { type: Number, default: 0 },
  isTrial: { type: Boolean, default: false },
  trialItems: [{
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    name: { type: String },
    image: { type: String },
    price: { type: Number },
    size: { type: String, default: 'M' },
    productSource: { type: String, enum: ['Retailer', 'Manufacturer'], default: 'Manufacturer' }
  }],
  deliveryType: {
    type: String,
    enum: ['regular', 'standard', 'priority'],
    default: 'regular'
  },
  deliveryETA: { type: String, default: '45 minutes' },
  totalBeforeDiscount: { type: Number, default: 0 }, // subtotal + delivery + trialFee
  voucherDiscount: { type: Number, default: 0 },
  voucher: {
    voucherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Voucher' },
    code: { type: String },
    discountType: { type: String, enum: ['percentage', 'fixed'] },
    discountValue: { type: Number },
    discountAmount: { type: Number, default: 0 },
    usageApplied: { type: Boolean, default: false }
  },
  total: { type: Number, required: true }, // final payable amount after discount


  status: {
    type: String,
    default: 'pending',
    enum: ['pending', 'confirmed', 'accepted', 'picked_up', 'out_for_delivery', 'delivered', 'failed', 'cancelled']
  },

  // Delivery Status (controlled by delivery partner)
  deliveryStatus: {
    type: String,
    enum: ['confirmed', 'accepted', 'picked_up', 'out_for_delivery', 'delivered', 'cancelled'],
    default: 'confirmed'
  },

  // Status History (timeline of all status changes)
  statusHistory: [{
    status: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedByRole: { type: String }
  }],

  // Delivery partner info (no live location)
  deliveryPartner: {
    id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    riderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name: { type: String },
    phone: { type: String },
    photo: { type: String },
    rating: { type: Number },
    vehicleType: { type: String },
    location: {
      lat: { type: Number },
      lng: { type: Number }
    }
  },

  payment: {
    method: { type: String, enum: ['razorpay', 'cod', 'online'], default: 'razorpay' },
    transactionId: { type: String },
    razorpayOrderId: { type: String },
    status: { type: String, enum: ['pending', 'success', 'failed', 'cod_pending', 'cod_collected'], default: 'pending' },
    codAmount: { type: Number, default: 0 }
  },
  shippingAddress: {
    name: { type: String },
    phone: { type: String },
    line1: { type: String },
    line2: { type: String },
    street: { type: String },
    city: { type: String },
    state: { type: String },
    pincode: { type: String },
    zip: { type: String },
    latitude: { type: Number },
    longitude: { type: Number }
  },
  deliveryUpdates: [{
    status: { type: String },
    note: { type: String },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedByRole: { type: String },
    updatedAt: { type: Date, default: Date.now }
  }],

  // Assigned delivery partner (Feature 1)
  assignedDeliveryPartner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true // Index for fast queries
  },
  assignedAt: { type: Date },
  assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  deliverySlot: { type: String, default: null },

  // Proof of Delivery (Feature 4)
  proofOfDelivery: {
    photoUrl: { type: String },
    deliveredAt: { type: Date },
    deliveredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    signature: { type: String },
    notes: { type: String }
  },

  // Store buyer state code for tax calculation
  buyerStateCode: { type: String, default: '27' },

  // One-shot markers so a customer push is never sent twice for the same event,
  // even when two paths race (e.g. verifyPayment and the Razorpay webhook).
  pushFlags: {
    orderConfirmedSentAt: { type: Date, default: null },
    paymentFailedSentAt: { type: Date, default: null },
    lastStatusPushed: { type: String, default: null }
  }
}, { timestamps: true })

module.exports = mongoose.models.Order || mongoose.model('Order', OrderSchema)
