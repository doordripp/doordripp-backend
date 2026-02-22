const mongoose = require('mongoose')

const OrderItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  name: { type: String, required: true },
  quantity: { type: Number, required: true },
  price: { type: Number, required: true },
  image: { type: String },
  // GST Details per item
  gstRate: { type: Number, default: 0 }, // 5, 12, 18, 28, etc.
  cgst: { type: Number, default: 0 },
  sgst: { type: Number, default: 0 },
  igst: { type: Number, default: 0 },
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
  deliveryType: { 
    type: String, 
    enum: ['regular', 'standard', 'priority'],
    default: 'regular' 
  },
  deliveryETA: { type: String, default: '45 minutes' },
  total: { type: Number, required: true }, // subtotal + GST + delivery
  
  status: { 
    type: String, 
    default: 'pending', 
    enum: ['pending', 'confirmed', 'packed', 'processing', 'shipped', 'delivered', 'cancelled'] 
  },
  payment: {
    method: { type: String },
    transactionId: { type: String },
    razorpayOrderId: { type: String },
    status: { type: String, default: 'pending' }
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
  // Store buyer state code for tax calculation
  buyerStateCode: { type: String, default: '27' }
}, { timestamps: true })

module.exports = mongoose.models.Order || mongoose.model('Order', OrderSchema)
