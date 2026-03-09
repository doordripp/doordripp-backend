const express = require('express')
const router = express.Router()
const cartController = require('../controllers/cartController')
const { verifyToken } = require('../middleware/auth')

router.get('/', verifyToken, cartController.getCart)
router.post('/add', verifyToken, cartController.addItem)
router.post('/update-quantity', verifyToken, cartController.updateQuantity)
router.post('/remove', verifyToken, cartController.removeItem)
router.post('/sync', verifyToken, cartController.syncCart)
router.post('/clear', verifyToken, cartController.clearCart)
router.post('/checkout', verifyToken, cartController.checkout)

module.exports = router
