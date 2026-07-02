const express = require('express')
const rateLimit = require('express-rate-limit')
const voucherController = require('../controllers/voucherController')
const { verifyToken } = require('../middleware/auth')

const router = express.Router()

const applyVoucherLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many voucher attempts. Please try again later.' }
})

router.post('/apply', verifyToken, applyVoucherLimiter, voucherController.applyVoucher)

module.exports = router
