const Review = require('../models/Review')
const Product = require('../models/Product')
const Order = require('../models/Order')
const mongoose = require('mongoose')
const logger = require('../utils/logger')

function sanitizeReviewImages(images) {
  if (images === undefined) return undefined
  if (!Array.isArray(images)) return null
  if (images.length > 5) return null

  const cleaned = images
    .filter(image => typeof image === 'string')
    .map(image => image.trim())
    .filter(Boolean)

  const hasInvalid = cleaned.some(
    image => !/^https?:\/\//i.test(image) && !/^\/uploads\//i.test(image)
  )

  if (hasInvalid) return null

  return cleaned
}

const resolveProductId = async (rawId) => {
  if (!rawId) return null
  const candidate = String(rawId).trim()
  if (mongoose.Types.ObjectId.isValid(candidate)) {
    const exists = await Product.exists({ _id: candidate })
    return exists ? candidate : null
  }
  const bySlug = await Product.findOne({ slug: candidate }).select('_id').lean()
  return bySlug?._id ? String(bySlug._id) : null
}

// Get reviews for a product (or all reviews) with filtering and sorting
exports.getProductReviews = async (req, res, next) => {
  try {
    const targetProductIdRaw = req.params.productId || req.params.id || req.query.productId || req.query.product
    const targetProductId = targetProductIdRaw ? await resolveProductId(targetProductIdRaw) : null
    const { 
      page = 1, 
      limit = 10, 
      sortBy = 'newest', 
      rating,
      verified = false 
    } = req.query

    const filter = {
      isApproved: true,
      isDeleted: false
    }

    if (targetProductId) {
      filter.product = targetProductId
    }

    // Filter by rating if specified
    if (rating && rating !== 'all') {
      filter.rating = parseInt(rating)
    }

    // Filter by verified purchases
    if (verified === 'true') {
      filter.isVerifiedPurchase = true
    }

    let sortOptions = {}
    switch (sortBy) {
      case 'helpful':
        sortOptions = { helpfulVotes: -1, createdAt: -1 }
        break
      case 'newest':
        sortOptions = { createdAt: -1 }
        break
      case 'oldest':
        sortOptions = { createdAt: 1 }
        break
      case 'highest':
        sortOptions = { rating: -1, createdAt: -1 }
        break
      case 'lowest':
        sortOptions = { rating: 1, createdAt: -1 }
        break
      default:
        sortOptions = { createdAt: -1 }
    }

    const reviews = await Review.find(filter)
      .populate('user', 'name avatar')
      .populate('product', 'name images price slug')
      .populate('order', 'id orderDate')
      .sort(sortOptions)
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))

    const totalReviews = await Review.countDocuments(filter)

    // Get rating distribution
    const matchStage = {
      isApproved: true,
      isDeleted: false
    }
    if (targetProductId && mongoose.Types.ObjectId.isValid(targetProductId)) {
      matchStage.product = new mongoose.Types.ObjectId(targetProductId)
    }

    const ratingStats = await Review.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$rating',
          count: { $sum: 1 }
        }
      }
    ])

    const ratingDistribution = {
      1: 0, 2: 0, 3: 0, 4: 0, 5: 0
    }
    ratingStats.forEach(stat => {
      if (stat._id >= 1 && stat._id <= 5) {
        ratingDistribution[stat._id] = stat.count
      }
    })

    const totalRatingReviews = Object.values(ratingDistribution).reduce((a, b) => a + b, 0)
    const averageRating = totalRatingReviews > 0 
      ? Object.entries(ratingDistribution).reduce((acc, [ratingVal, count]) => {
          return acc + (parseInt(ratingVal) * count)
        }, 0) / totalRatingReviews 
      : 0

    res.json({
      reviews,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalReviews / parseInt(limit)),
        totalReviews,
        hasNext: parseInt(page) * parseInt(limit) < totalReviews,
        hasPrev: parseInt(page) > 1
      },
      stats: {
        averageRating: parseFloat(averageRating.toFixed(1)),
        totalReviews: totalRatingReviews,
        ratingDistribution
      }
    })
  } catch (err) {
    next(err)
  }
}

// Create a new review
exports.createReview = async (req, res, next) => {
  try {
    const targetProductIdRaw = req.params.productId || req.params.id || req.body.productId || req.body.product
    const targetProductId = targetProductIdRaw ? await resolveProductId(targetProductIdRaw) : null
    const { rating, title, comment, images } = req.body
    const userId = req.user.id

    logger.info('Review submission data:', { rating, title, comment, imagesCount: Array.isArray(images) ? images.length : 0, userId, productId: targetProductId })

    // Validate required fields
    if (!targetProductId) {
      return res.status(400).json({
        error: 'Product not found or invalid product ID'
      })
    }

    if (!rating) {
      return res.status(400).json({ 
        error: 'Rating is required' 
      })
    }
    
    if (!comment) {
      return res.status(400).json({ 
        error: 'Comment is required' 
      })
    }

    // Validate rating range
    if (rating < 1 || rating > 5) {
      return res.status(400).json({ 
        error: 'Rating must be between 1 and 5' 
      })
    }

    const sanitizedImages = sanitizeReviewImages(images)
    if (sanitizedImages === null) {
      return res.status(400).json({
        error: 'Review images must be an array of up to 5 valid image URLs'
      })
    }

    // Check if user has purchased this product
    const userOrder = await Order.findOne({
      user: userId,
      'items.product': targetProductId,
      status: { $in: ['confirmed', 'shipped', 'delivered'] }
    })

    // Get device info from headers
    const deviceInfo = {
      platform: req.headers['user-agent']?.includes('Mobile') ? 'mobile' : 'desktop',
      browser: req.headers['user-agent']?.split(' ')[0] || 'unknown'
    }

    const reviewData = {
      product: targetProductId,
      user: userId,
      rating: parseInt(rating),
      comment: comment,
      images: sanitizedImages || [],
      isVerifiedPurchase: !!userOrder,
      order: userOrder?._id,
      deviceInfo
    }

    // Only add title if it's provided and not empty
    if (title && typeof title === 'string') {
      reviewData.title = title
    }

    const review = new Review(reviewData)
    await review.save()

    // Update product rating
    await updateProductRating(targetProductId)

    // Populate user info for response
    await review.populate('user', 'name email')

    res.status(201).json({
      success: true,
      message: 'Review created successfully',
      review
    })
  } catch (err) {
    logger.error('Review creation error:', err)
    next(err)
  }
}

// Update a review
exports.updateReview = async (req, res, next) => {
  try {
    const { reviewId } = req.params
    const { rating, title, comment, images } = req.body
    const userId = req.user.id

    // Validate required fields
    if (!rating) {
      return res.status(400).json({ 
        error: 'Rating is required' 
      })
    }
    
    if (!comment) {
      return res.status(400).json({ 
        error: 'Comment is required' 
      })
    }

    // Validate rating range
    if (rating < 1 || rating > 5) {
      return res.status(400).json({ 
        error: 'Rating must be between 1 and 5' 
      })
    }

    const sanitizedImages = sanitizeReviewImages(images)
    if (sanitizedImages === null) {
      return res.status(400).json({
        error: 'Review images must be an array of up to 5 valid image URLs'
      })
    }

    const review = await Review.findOne({
      _id: reviewId,
      user: userId,
      isDeleted: false
    })

    if (!review) {
      return res.status(404).json({ 
        error: 'Review not found or you do not have permission to edit it' 
      })
    }

    // Update review
    review.rating = parseInt(rating)
    review.comment = comment
    if (sanitizedImages !== undefined) {
      review.images = sanitizedImages
    }
    
    // Only update title if provided
    if (title !== undefined && typeof title === 'string') {
      review.title = title
    }
    
    review.isEdited = true
    review.editedAt = new Date()

    await review.save()

    // Update product rating
    await updateProductRating(review.product)

    await review.populate('user', 'name email')

    res.json({
      success: true,
      message: 'Review updated successfully',
      review
    })
  } catch (err) {
    next(err)
  }
}

// Delete a review (soft delete)
exports.deleteReview = async (req, res, next) => {
  try {
    const { reviewId } = req.params
    const userId = req.user.id

    const review = await Review.findOne({
      _id: reviewId,
      user: userId,
      isDeleted: false
    })

    if (!review) {
      return res.status(404).json({ error: 'Review not found' })
    }

    review.isDeleted = true
    await review.save()

    // Update product rating
    await updateProductRating(review.product)

    res.json({ message: 'Review deleted successfully' })
  } catch (err) {
    next(err)
  }
}

// Vote on a review (helpful/unhelpful)
exports.voteOnReview = async (req, res, next) => {
  try {
    const { reviewId } = req.params
    const { vote } = req.body // 'helpful' or 'unhelpful'
    const userId = req.user.id
    const userIdString = String(userId)

    if (!['helpful', 'unhelpful'].includes(vote)) {
      return res.status(400).json({ error: 'Invalid vote type' })
    }

    const review = await Review.findById(reviewId)
    if (!review || review.isDeleted) {
      return res.status(404).json({ error: 'Review not found' })
    }

    // Toggle behavior: clicking the same vote again removes it.
    const existingVote = review.votedUsers.find(v => String(v.user) === userIdString)

    if (existingVote && existingVote.vote === vote) {
      review.votedUsers = review.votedUsers.filter(v => String(v.user) !== userIdString)
    } else {
      review.votedUsers = review.votedUsers.filter(v => String(v.user) !== userIdString)
      review.votedUsers.push({ user: userId, vote })
    }

    // Recalculate counters from source of truth.
    review.helpfulVotes = review.votedUsers.filter(v => v.vote === 'helpful').length
    review.unhelpfulVotes = review.votedUsers.filter(v => v.vote === 'unhelpful').length

    await review.save()

    res.json({
      message: existingVote && existingVote.vote === vote ? 'Vote removed successfully' : 'Vote recorded successfully',
      helpfulVotes: review.helpfulVotes,
      unhelpfulVotes: review.unhelpfulVotes
    })
  } catch (err) {
    next(err)
  }
}

// Remove vote from a review
exports.removeVote = async (req, res, next) => {
  try {
    const { reviewId } = req.params
    const userId = req.user.id
    const userIdString = String(userId)

    const review = await Review.findById(reviewId)
    if (!review || review.isDeleted) {
      return res.status(404).json({ error: 'Review not found' })
    }

    // Remove user's vote
    const userVote = review.votedUsers.find(v => String(v.user) === userIdString)
    if (!userVote) {
      return res.status(400).json({ error: 'You have not voted on this review' })
    }

    review.votedUsers = review.votedUsers.filter(
      v => String(v.user) !== userIdString
    )

    // Recalculate votes
    review.helpfulVotes = review.votedUsers.filter(v => v.vote === 'helpful').length
    review.unhelpfulVotes = review.votedUsers.filter(v => v.vote === 'unhelpful').length

    await review.save()

    res.json({
      message: 'Vote removed successfully',
      helpfulVotes: review.helpfulVotes,
      unhelpfulVotes: review.unhelpfulVotes
    })
  } catch (err) {
    next(err)
  }
}

// Get single review by ID
exports.getReviewById = async (req, res, next) => {
  try {
    const { reviewId } = req.params
    const review = await Review.findOne({
      _id: reviewId,
      isApproved: true,
      isDeleted: false
    })
      .populate('user', 'name avatar')
      .populate('product', 'name images price slug category subcategory')
      .populate('order', 'id orderDate')

    if (!review) {
      return res.status(404).json({ error: 'Review not found' })
    }

    res.json({ review })
  } catch (err) {
    next(err)
  }
}

// Get all reviews submitted by the logged-in user
exports.getMyReviews = async (req, res, next) => {
  try {
    const userId = req.user.id
    const { page = 1, limit = 20 } = req.query

    const filter = {
      user: userId,
      isDeleted: false
    }

    const reviews = await Review.find(filter)
      .populate('product', 'name images price slug category subcategory')
      .populate('order', 'id orderDate')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))

    const totalReviews = await Review.countDocuments(filter)

    res.json({
      reviews,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalReviews / parseInt(limit)),
        totalReviews,
        hasNext: parseInt(page) * parseInt(limit) < totalReviews,
        hasPrev: parseInt(page) > 1
      }
    })
  } catch (err) {
    next(err)
  }
}

// Get user's review for a specific product
exports.getUserReview = async (req, res, next) => {
  try {
    const targetProductIdRaw = req.params.productId || req.params.id || req.query.productId || req.query.product
    const targetProductId = targetProductIdRaw ? await resolveProductId(targetProductIdRaw) : null
    const userId = req.user.id

    if (!targetProductId) {
      return res.status(400).json({ error: 'Product not found or invalid product ID' })
    }

    const review = await Review.findOne({
      product: targetProductId,
      user: userId,
      isDeleted: false
    }).populate('user', 'name avatar')

    res.json({ review })
  } catch (err) {
    next(err)
  }
}

// Helper function to update product rating
async function updateProductRating(productId) {
  try {
    const stats = await Review.aggregate([
      {
        $match: {
          product: new mongoose.Types.ObjectId(productId),
          isApproved: true,
          isDeleted: false
        }
      },
      {
        $group: {
          _id: null,
          averageRating: { $avg: '$rating' },
          totalReviews: { $sum: 1 }
        }
      }
    ])

    const rating = stats.length > 0 ? {
      rating: parseFloat(stats[0].averageRating.toFixed(1)),
      reviews: stats[0].totalReviews
    } : {
      rating: 0,
      reviews: 0
    }

    await Product.findByIdAndUpdate(productId, { rating })
  } catch (err) {
    logger.error('Error updating product rating:', err)
  }
}
