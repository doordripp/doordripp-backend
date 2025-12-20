const mongoose = require('mongoose')

const OrderItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  name: { type: String, required: true },
  quantity: { type: Number, required: true },
  price: { type: Number, required: true },
  image: { type: String }
})

const OrderSchema = new mongoose.Schema({
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  items: [OrderItemSchema],
  total: { type: Number, required: true },
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
    zip: { type: String }
  }
}, { timestamps: true })

module.exports = mongoose.models.Order || mongoose.model('Order', OrderSchema)
