const express = require('express')
const router = express.Router()
const { verifyToken } = require('../middleware/auth')
const reviewController = require('../controllers/reviewController')

// Get reviews (query params ?productId=... or ?product=..., or all reviews)
router.get('/', reviewController.getProductReviews)

// Get logged-in user's submitted reviews across products (requires auth)
router.get('/user/me', verifyToken, reviewController.getMyReviews)

// Get reviews for a product
router.get('/product/:productId', reviewController.getProductReviews)

// Get user's review for a product (requires auth)
router.get('/product/:productId/my-review', verifyToken, reviewController.getUserReview)

// Create a review (requires auth)
router.post('/product/:productId', verifyToken, reviewController.createReview)

// Get single review by ID
router.get('/:reviewId', reviewController.getReviewById)

// Update a review (requires auth)
router.put('/:reviewId', verifyToken, reviewController.updateReview)

// Delete a review (requires auth)
router.delete('/:reviewId', verifyToken, reviewController.deleteReview)

// Vote on a review (requires auth)
router.post('/:reviewId/vote', verifyToken, reviewController.voteOnReview)

// Remove vote from a review (requires auth)
router.delete('/:reviewId/vote', verifyToken, reviewController.removeVote)

module.exports = router