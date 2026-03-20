const Product = require('../models/Product')

exports.list = async (req, res, next) => {
  try {
    const { search, category, sort } = req.query
    const filter = {}
    if (category && category !== 'All') filter.category = category
    
    // Improved, strict search matching
    if (search) {
      const searchRegex = new RegExp(search, 'i')
      filter.$or = [
        { name: searchRegex },
        { category: searchRegex },
        { subcategory: searchRegex }
      ]
    }

    let query = Product.find(filter).limit(500)

    if (sort === 'price-low') query = query.sort({ price: 1 })
    else if (sort === 'price-high') query = query.sort({ price: -1 })
    else if (sort === 'name') query = query.sort({ name: 1 })
    else query = query.sort({ createdAt: -1 })

    const products = await query.exec()
    res.json(products)
  } catch (err) {
    next(err)
  }
}

exports.get = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id)
    if (!product) return res.status(404).json({ error: 'Not found' })
    res.json(product)
  } catch (err) {
    next(err)
  }
}

// Get related products with smart recommendation algorithm
exports.getRelatedProducts = async (req, res, next) => {
  try {
    const { id } = req.params
    const { limit = 8 } = req.query
    
    // Get the current product
    const currentProduct = await Product.findById(id)
    if (!currentProduct) {
      return res.status(404).json({ error: 'Product not found' })
    }

    // Build recommendation query with multiple criteria
    const recommendations = []
    
    // 1. Same category and subcategory (highest priority)
    if (currentProduct.category && currentProduct.subcategory) {
      const exactMatch = await Product.find({
        _id: { $ne: id },
        category: currentProduct.category,
        subcategory: currentProduct.subcategory
      }).limit(4)
      recommendations.push(...exactMatch)
    }
    
    // 2. Same category, different subcategory
    if (currentProduct.category && recommendations.length < limit) {
      const categoryMatch = await Product.find({
        _id: { $ne: id },
        category: currentProduct.category,
        subcategory: { $ne: currentProduct.subcategory }
      }).limit(3)
      recommendations.push(...categoryMatch)
    }
    
    // 3. Similar price range (±30%)
    if (recommendations.length < limit) {
      const priceMin = currentProduct.price * 0.7
      const priceMax = currentProduct.price * 1.3
      const priceMatch = await Product.find({
        _id: { $ne: id },
        price: { $gte: priceMin, $lte: priceMax },
        category: { $ne: currentProduct.category }
      }).limit(2)
      recommendations.push(...priceMatch)
    }
    
    // 4. Description keyword matching
    if (recommendations.length < limit && currentProduct.description) {
      // Extract keywords from current product description
      const keywords = currentProduct.description
        .toLowerCase()
        .split(/\s+/)
        .filter(word => word.length > 3) // Filter meaningful words
        .slice(0, 5) // Top 5 keywords
      
      if (keywords.length > 0) {
        const keywordRegex = keywords.map(keyword => new RegExp(keyword, 'i'))
        const descMatch = await Product.find({
          _id: { $ne: id },
          $or: keywordRegex.map(regex => ({ description: regex }))
        }).limit(2)
        recommendations.push(...descMatch)
      }
    }
    
    // 5. Fill remaining with popular/recent products
    if (recommendations.length < limit) {
      const fallback = await Product.find({
        _id: { $ne: id }
      })
      .sort({ createdAt: -1 }) // Most recent first
      .limit(limit - recommendations.length)
      
      recommendations.push(...fallback)
    }
    
    // Remove duplicates and limit results
    const uniqueProducts = []
    const seenIds = new Set([id]) // Exclude current product
    
    for (const product of recommendations) {
      const productId = product._id.toString()
      if (!seenIds.has(productId) && uniqueProducts.length < limit) {
        seenIds.add(productId)
        uniqueProducts.push({
          _id: product._id,
          id: product._id,
          name: product.name,
          slug: product.slug,
          description: product.description,
          price: product.price,
          originalPrice: product.originalPrice,
          discount: product.discount,
          category: product.category,
          subcategory: product.subcategory,
          images: product.images || [],
          image: product.images && product.images.length > 0 ? product.images[0] : null,
          colors: product.colors || [],
          sizes: product.sizes || [],
          rating: product.rating || { rating: 4.5, reviews: 0 },
          stock: product.stock || 0
        })
      }
    }
    
    res.json({
      success: true,
      currentProduct: {
        id: currentProduct._id,
        name: currentProduct.name,
        category: currentProduct.category,
        subcategory: currentProduct.subcategory
      },
      relatedProducts: uniqueProducts,
      count: uniqueProducts.length
    })
    
  } catch (err) {
    logger.error('Related products error:', err)
    next(err)
  }
}

// Get smart recommendations for cart/general use
exports.getRecommendations = async (req, res, next) => {
  try {
    const { categories, subcategories, excludeIds, limit = 6 } = req.query
    
    const filter = { _id: { $nin: excludeIds ? excludeIds.split(',') : [] } }
    
    // If categories provided, use them for targeted recommendations
    if (categories) {
      const categoryList = categories.split(',')
      filter.category = { $in: categoryList }
    }
    
    if (subcategories) {
      const subcategoryList = subcategories.split(',')
      filter.subcategory = { $in: subcategoryList }
    }
    
    const products = await Product.find(filter)
      .sort({ createdAt: -1, rating: -1 })
      .limit(parseInt(limit))
    
    const formattedProducts = products.map(product => ({
      _id: product._id,
      id: product._id,
      name: product.name,
      slug: product.slug,
      description: product.description,
      price: product.price,
      originalPrice: product.originalPrice,
      discount: product.discount,
      category: product.category,
      subcategory: product.subcategory,
      images: product.images || [],
      image: product.images && product.images.length > 0 ? product.images[0] : null,
      colors: product.colors || [],
      sizes: product.sizes || [],
      rating: product.rating || { rating: 4.5, reviews: 0 },
      stock: product.stock || 0
    }))
    
    res.json({
      success: true,
      recommendations: formattedProducts,
      count: formattedProducts.length
    })
    
  } catch (err) {
    logger.error('Recommendations error:', err)
    next(err)
  }
}

exports.create = async (req, res, next) => {
  try {
    const payload = req.body
    const existing = await Product.findOne({ slug: payload.slug })
    if (existing) return res.status(400).json({ error: 'Slug already exists' })
    const product = new Product(payload)
    await product.save()
    res.status(201).json(product)
  } catch (err) {
    next(err)
  }
}

exports.update = async (req, res, next) => {
  try {
    const updated = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true })
    res.json(updated)
  } catch (err) {
    next(err)
  }
}

exports.remove = async (req, res, next) => {
  try {
    await Product.findByIdAndDelete(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
}
