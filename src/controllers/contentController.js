const Banner = require('../models/Banner')
const Category = require('../models/Category')
const TeamMember = require('../models/TeamMember')

// Add a new banner
exports.createBanner = async (req, res, next) => {
  try {
    const { title, imageUrl, imageKitId, link, type, platform, order } = req.body

    if (!imageUrl) {
      return res.status(400).json({ success: false, message: 'Image URL is required' })
    }

    const singleCategories = ['new_arrivals', 'best_sellers', 'featured', 'accessories', 'men', 'women'];
    if (singleCategories.includes(type)) {
      const existing = await Banner.findOne({ type, platform: platform || 'app' });
      if (existing) {
        return res.status(400).json({ success: false, message: `Only 1 image allowed for this category on ${platform || 'app'}. Please delete the existing one first.` });
      }
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
    if (platform) {
      if (platform === 'website') {
        filter.platform = { $in: ['website', 'both'] }
      } else if (platform === 'app') {
        filter.platform = { $in: ['app', 'both'] }
      } else {
        filter.platform = platform
      }
    }
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
      { returnDocument: 'after' }
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

    const singleCategories = ['new_arrivals', 'best_sellers', 'featured', 'accessories', 'men', 'women'];
    if (type && singleCategories.includes(type)) {
      const currentBanner = await Banner.findById(req.params.id);
      if (currentBanner) {
        const targetPlatform = platform || currentBanner.platform;
        const existing = await Banner.findOne({
          type,
          platform: targetPlatform,
          _id: { $ne: req.params.id }
        });
        if (existing) {
          return res.status(400).json({ success: false, message: `Only 1 image allowed for this category on ${targetPlatform}. Please delete the existing one first.` });
        }
      }
    }

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
      { returnDocument: 'after', runValidators: true }
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
      { returnDocument: 'after' }
    )
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' })
    }
    res.json({ success: true, category })
  } catch (err) {
    next(err)
  }
}

// ==================== TEAM MEMBERS ====================
// Public list (active only by default)
exports.getTeamMembers = async (req, res, next) => {
  try {
    const { activeOnly } = req.query
    const filter = {}
    if (activeOnly !== 'false') filter.isActive = true

    const members = await TeamMember.find(filter).sort({ order: 1, createdAt: -1 })
    res.json({ success: true, members })
  } catch (err) {
    next(err)
  }
}

exports.createTeamMember = async (req, res, next) => {
  try {
    const {
      name,
      roleTitle,
      companyLabel,
      introLabel,
      photoUrl,
      statement,
      order,
      isActive
    } = req.body

    if (!name || !roleTitle || !photoUrl || !statement) {
      return res.status(400).json({
        success: false,
        message: 'Name, role title, photo URL and statement are required'
      })
    }

    const member = new TeamMember({
      name,
      roleTitle,
      companyLabel,
      introLabel,
      photoUrl,
      statement,
      order: Number.isFinite(Number(order)) ? Number(order) : 0,
      isActive: isActive !== false
    })

    await member.save()
    res.status(201).json({ success: true, member })
  } catch (err) {
    next(err)
  }
}

exports.updateTeamMember = async (req, res, next) => {
  try {
    const updateData = {}
    const fields = [
      'name',
      'roleTitle',
      'companyLabel',
      'introLabel',
      'photoUrl',
      'statement',
      'isActive'
    ]

    fields.forEach((field) => {
      if (req.body[field] !== undefined) updateData[field] = req.body[field]
    })

    if (req.body.order !== undefined) {
      updateData.order = Number.isFinite(Number(req.body.order)) ? Number(req.body.order) : 0
    }

    const member = await TeamMember.findByIdAndUpdate(
      req.params.id,
      updateData,
      { returnDocument: 'after', runValidators: true }
    )

    if (!member) {
      return res.status(404).json({ success: false, message: 'Team member not found' })
    }

    res.json({ success: true, member })
  } catch (err) {
    next(err)
  }
}

exports.deleteTeamMember = async (req, res, next) => {
  try {
    const member = await TeamMember.findByIdAndDelete(req.params.id)
    if (!member) {
      return res.status(404).json({ success: false, message: 'Team member not found' })
    }

    res.json({ success: true, message: 'Team member deleted successfully' })
  } catch (err) {
    next(err)
  }
}

exports.toggleTeamMemberStatus = async (req, res, next) => {
  try {
    const { isActive } = req.body

    const member = await TeamMember.findByIdAndUpdate(
      req.params.id,
      { isActive },
      { returnDocument: 'after' }
    )

    if (!member) {
      return res.status(404).json({ success: false, message: 'Team member not found' })
    }

    res.json({ success: true, member })
  } catch (err) {
    next(err)
  }
}
