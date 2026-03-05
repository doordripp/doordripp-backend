const Banner = require('../models/Banner')
const Category = require('../models/Category')

// Add a new banner
exports.createBanner = async (req, res, next) => {
  try {
    const { title, imageUrl, imageKitId, link, type, platform, order } = req.body
    
    if (!imageUrl) {
      return res.status(400).json({ success: false, message: 'Image URL is required' })
    }

    const banner = new Banner({
      title: title || 'Promo Banner',
      imageUrl,
      imageKitId,
      link: link || '#',
      type: type || 'promo',
      platform: platform || 'app',
      order: order || 0
    })

    await banner.save()
    res.status(201).json({ success: true, banner })
  } catch (err) {
    next(err)
  }
}

// Get all banners (optionally filtered by type)
exports.getBanners = async (req, res, next) => {
  try {
    const { type, platform, activeOnly } = req.query
    const filter = {}
    if (type) filter.type = type
    if (platform) filter.platform = platform
    if (activeOnly === 'true') filter.isActive = true

    const banners = await Banner.find(filter).sort({ order: 1, createdAt: -1 })
    res.json({ success: true, banners })
  } catch (err) {
    next(err)
  }
}

// Delete a banner
exports.deleteBanner = async (req, res, next) => {
  try {
    const banner = await Banner.findByIdAndDelete(req.params.id)
    if (!banner) {
      return res.status(404).json({ success: false, message: 'Banner not found' })
    }
    res.json({ success: true, message: 'Banner deleted successfully' })
  } catch (err) {
    next(err)
  }
}

// Update banner status (Active/Inactive)
exports.updateStatus = async (req, res, next) => {
  try {
    const { isActive } = req.body
    const banner = await Banner.findByIdAndUpdate(
      req.params.id,
      { isActive },
      { new: true }
    )
    if (!banner) {
      return res.status(404).json({ success: false, message: 'Banner not found' })
    }
    res.json({ success: true, banner })
  } catch (err) {
    next(err)
  }
}

// Update banner - Full update
exports.updateBanner = async (req, res, next) => {
  try {
    const { title, imageUrl, imageKitId, link, type, platform, order, isActive } = req.body
    
    const updateData = {}
    if (title !== undefined) updateData.title = title
    if (imageUrl !== undefined) updateData.imageUrl = imageUrl
    if (imageKitId !== undefined) updateData.imageKitId = imageKitId
    if (link !== undefined) updateData.link = link
    if (type !== undefined) updateData.type = type
    if (platform !== undefined) updateData.platform = platform
    if (order !== undefined) updateData.order = order
    if (isActive !== undefined) updateData.isActive = isActive

    const banner = await Banner.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    )
    
    if (!banner) {
      return res.status(404).json({ success: false, message: 'Banner not found' })
    }
    
    res.json({ success: true, banner })
  } catch (err) {
    next(err)
  }
}

// ==================== CATEGORIES ====================
// Add a new category
exports.createCategory = async (req, res, next) => {
  try {
    const { name, slug, imageUrl, imageKitId, description, order } = req.body
    
    if (!name || !imageUrl) {
      return res.status(400).json({ success: false, message: 'Name and Image URL are required' })
    }

    const category = new Category({
      name,
      slug: slug || name.toLowerCase().replace(/ /g, '-'),
      imageUrl,
      imageKitId,
      description,
      order: order || 0
    })

    await category.save()
    res.status(201).json({ success: true, category })
  } catch (err) {
    next(err)
  }
}

// Get all categories
exports.getCategories = async (req, res, next) => {
  try {
    const { activeOnly } = req.query
    const filter = {}
    if (activeOnly === 'true') filter.isActive = true

    const categories = await Category.find(filter).sort({ order: 1, createdAt: -1 })
    res.json({ success: true, categories })
  } catch (err) {
    next(err)
  }
}

// Delete a category
exports.deleteCategory = async (req, res, next) => {
  try {
    const category = await Category.findByIdAndDelete(req.params.id)
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' })
    }
    res.json({ success: true, message: 'Category deleted successfully' })
  } catch (err) {
    next(err)
  }
}

// Update category status
exports.updateCategoryStatus = async (req, res, next) => {
  try {
    const { isActive } = req.body
    const category = await Category.findByIdAndUpdate(
      req.params.id,
      { isActive },
      { new: true }
    )
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' })
    }
    res.json({ success: true, category })
  } catch (err) {
    next(err)
  }
}
