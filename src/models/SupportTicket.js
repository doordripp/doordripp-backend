const mongoose = require('mongoose')

const SupportTicketSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true },
  orderId: { type: String, trim: true },
  message: { type: String, required: true, trim: true },
  language: { type: String, default: 'en' },
  status: { type: String, default: 'new' },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true })

module.exports = mongoose.models.SupportTicket || mongoose.model('SupportTicket', SupportTicketSchema)
