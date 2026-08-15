const mongoose = require('mongoose')
const Wishlist = require('../models/Wishlist')
const Product = require('../models/Product')

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

// Get user's wishlist
exports.getWishlist = async (req, res, next) => {
  try {
    // Return empty wishlist if user not authenticated
    if (!req.user || !req.user.id) {
      return res.json({ items: [] })
    }

    const wishlist = await Wishlist.findOne({ user: req.user.id })
      .populate('items.product', 'name price originalPrice discount category stock images')
      .lean()

    if (!wishlist) {
      return res.json({ items: [] })
    }

    // Filter out items where product no longer exists and map items to include product details
    const items = wishlist.items
      .filter(item => item.product) // Remove items with deleted products
      .map(item => ({
        id: item.product._id,
        name: item.product.name || item.name,
        image: item.product.images?.[0] || item.image,
        price: item.product.price || item.price,
        originalPrice: item.product.originalPrice || item.originalPrice,
        discount: item.product.discount || item.discount,
        category: item.product.category || item.category,
        stock: item.product.stock,
        addedAt: item.addedAt
      }))

    res.json({ items })
  } catch (err) {
    next(err)
  }
}

// Add item to wishlist
exports.addToWishlist = async (req, res, next) => {
  try {
    // Return error if user not authenticated
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    const { productId } = req.body

    if (!productId) {
      return res.status(400).json({ error: 'Product ID required' })
    }

    // Verify product exists by ObjectId or slug
    const resolvedProductId = await resolveProductId(productId)
    if (!resolvedProductId) {
      return res.status(404).json({ error: 'Product not found' })
    }

    const product = await Product.findById(resolvedProductId)
    if (!product) {
      return res.status(404).json({ error: 'Product not found' })
    }

    // Find or create wishlist
    let wishlist = await Wishlist.findOne({ user: req.user.id })

    if (!wishlist) {
      wishlist = await Wishlist.create({
        user: req.user.id,
        items: []
      })
    }

    // Check if product already in wishlist
    const existingItem = wishlist.items.find(
      item => item.product.toString() === resolvedProductId
    )

    if (existingItem) {
      return res.status(400).json({ error: 'Product already in wishlist' })
    }

    // Add to wishlist
    wishlist.items.push({
      product: resolvedProductId,
      name: product.name,
      image: product.images?.[0],
      price: product.price,
      originalPrice: product.originalPrice,
      discount: product.discount,
      category: product.category
    })

    await wishlist.save()

    res.status(201).json({
      message: 'Added to wishlist',
      item: wishlist.items[wishlist.items.length - 1]
    })
  } catch (err) {
    next(err)
  }
}

// Remove item from wishlist
exports.removeFromWishlist = async (req, res, next) => {
  try {
    // Return error if user not authenticated
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    const { productId } = req.body

    if (!productId) {
      return res.status(400).json({ error: 'Product ID required' })
    }

    const resolvedProductId = await resolveProductId(productId) || productId

    const wishlist = await Wishlist.findOne({ user: req.user.id })

    if (!wishlist) {
      return res.status(404).json({ error: 'Wishlist not found' })
    }

    // Remove item
    wishlist.items = wishlist.items.filter(
      item => item.product && item.product.toString() !== resolvedProductId.toString()
    )

    await wishlist.save()

    res.json({ message: 'Removed from wishlist' })
  } catch (err) {
    next(err)
  }
}

// Check if product is in wishlist
exports.isInWishlist = async (req, res, next) => {
  try {
    // Return false if user not authenticated
    if (!req.user || !req.user.id) {
      return res.json({ isInWishlist: false })
    }

    const { productId } = req.params
    if (!productId) {
      return res.json({ isInWishlist: false })
    }

    const resolvedProductId = await resolveProductId(productId)
    if (!resolvedProductId) {
      return res.json({ isInWishlist: false })
    }

    const wishlist = await Wishlist.findOne({ user: req.user.id })

    if (!wishlist) {
      return res.json({ isInWishlist: false })
    }

    const isInWishlist = wishlist.items.some(
      item => item.product && item.product.toString() === resolvedProductId.toString()
    )

    res.json({ isInWishlist })
  } catch (err) {
    next(err)
  }
}

// Clear wishlist
exports.clearWishlist = async (req, res, next) => {
  try {
    // Return error if user not authenticated
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    await Wishlist.findOneAndUpdate(
      { user: req.user.id },
      { items: [] }
    )

    res.json({ message: 'Wishlist cleared' })
  } catch (err) {
    next(err)
  }
}

module.exports = exports
