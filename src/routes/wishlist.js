const express = require('express')
const router = express.Router()
const wishlistController = require('../controllers/wishlistController')
const { verifyToken } = require('../middleware/auth')

// All wishlist routes require authentication
router.use(verifyToken)

// Get user's wishlist
router.get('/', wishlistController.getWishlist)

// Add item to wishlist
router.post('/add', wishlistController.addToWishlist)

// Remove item from wishlist
router.post('/remove', wishlistController.removeFromWishlist)

// Check if product is in wishlist
router.get('/check/:productId', wishlistController.isInWishlist)

// Clear wishlist
router.delete('/', wishlistController.clearWishlist)

module.exports = router
