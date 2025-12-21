const Wishlist = require('../models/Wishlist')
const Product = require('../models/Product')

// Get user's wishlist
exports.getWishlist = async (req, res, next) => {
  try {
    const wishlist = await Wishlist.findOne({ user: req.user.id })
      .populate('items.product', 'name price originalPrice discount category stock images')
      .lean()

    if (!wishlist) {
      return res.json({ items: [] })
    }

    // Map items to include product details
    const items = wishlist.items.map(item => ({
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
    const { productId } = req.body

    if (!productId) {
      return res.status(400).json({ error: 'Product ID required' })
    }

    // Verify product exists
    const product = await Product.findById(productId)
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
      item => item.product.toString() === productId
    )

    if (existingItem) {
      return res.status(400).json({ error: 'Product already in wishlist' })
    }

    // Add to wishlist
    wishlist.items.push({
      product: productId,
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
    const { productId } = req.body

    if (!productId) {
      return res.status(400).json({ error: 'Product ID required' })
    }

    const wishlist = await Wishlist.findOne({ user: req.user.id })

    if (!wishlist) {
      return res.status(404).json({ error: 'Wishlist not found' })
    }

    // Remove item
    wishlist.items = wishlist.items.filter(
      item => item.product.toString() !== productId
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
    const { productId } = req.params

    const wishlist = await Wishlist.findOne({ user: req.user.id })

    if (!wishlist) {
      return res.json({ isInWishlist: false })
    }

    const isInWishlist = wishlist.items.some(
      item => item.product.toString() === productId
    )

    res.json({ isInWishlist })
  } catch (err) {
    next(err)
  }
}

// Clear wishlist
exports.clearWishlist = async (req, res, next) => {
  try {
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
