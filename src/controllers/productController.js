const Product = require('../models/Product')
const escapeRegex = require('../utils/escapeRegex')
const { attachSaleInfoToProducts } = require('../utils/promotionHelpers')
const { buildProductInventoryPayload } = require('../utils/productInventory')

const { getPrecomputedHomePayload, refreshHomeProductsPrecomputation } = require('../services/homePrecomputeService')

function clearHomeCache() {
  refreshHomeProductsPrecomputation().catch(() => {})
}
exports.clearHomeCache = clearHomeCache;

exports.getHomeProducts = async (req, res, next) => {
  try {
    const precomputed = getPrecomputedHomePayload()
    if (precomputed && !req.query.refresh) {
      res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=1800')
      return res.json(precomputed)
    }

    const payload = await refreshHomeProductsPrecomputation()
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=1800')
    res.json(payload)
  } catch (err) {
    next(err)
  }
}

exports.list = async (req, res, next) => {
  try {
    const { search, category, subcategory, sort, page = 1, limit = 50, isNewArrival, isBestSeller, isFeatured } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const filter = {};
    // Delegate to search service for intelligent search
    if (search) {
      const searchService = require('../services/searchService')
      const searchResults = await searchService.search(search, {
        category: category || 'All',
        subcategory,
        sort,
        page: parseInt(page),
        limit: parseInt(limit),
        isNewArrival,
        isBestSeller,
        isFeatured
      })
      return res.json(searchResults)
    }
    if (isNewArrival === 'true' || isNewArrival === true) filter.isNewArrival = true;
    if (isBestSeller === 'true' || isBestSeller === true) filter.isBestSeller = true;
    if (isFeatured === 'true' || isFeatured === true) filter.isFeatured = true;
    if (subcategory) filter.subcategory = new RegExp(`^${escapeRegex(subcategory)}$`, 'i');

    if (category && category !== 'All') {
      const catLower = category.toLowerCase();
      if (catLower === 'men') {
        filter.category = { $regex: /^(men|both|unisex|both \(men & women\))$/i };
      } else if (catLower === 'women') {
        filter.category = { $regex: /^(women|both|unisex|both \(men & women\))$/i };
      } else if (catLower === 'both' || catLower.includes('both')) {
        filter.category = { $regex: /^(both|unisex|both \(men & women\))$/i };
      } else {
        filter.category = new RegExp(`^${escapeRegex(category)}$`, 'i');
      }
    }

    const { getVisibilityFilter } = require('../utils/visibility');
    Object.assign(filter, getVisibilityFilter());

    let sortOption = { createdAt: -1 };
    if (sort === 'price-low') sortOption = { price: 1 };
    else if (sort === 'price-high') sortOption = { price: -1 };
    else if (sort === 'name') sortOption = { name: 1 };

    const [products, total] = await Promise.all([
      Product.find(filter).skip(skip).limit(parseInt(limit)).sort(sortOption).lean(),
      Product.countDocuments(filter)
    ]);

    const enrichedProducts = await attachSaleInfoToProducts(products);

    const formattedProducts = enrichedProducts.map(p => {
      const inventory = buildProductInventoryPayload(p);
      return {
        id: p._id,
        _id: p._id,
        name: p.name,
        slug: p.slug,
        description: p.description,
        price: p.price,
        originalPrice: p.originalPrice,
        discount: p.discount,
        stock: inventory.stock,
        category: p.category,
        subcategory: p.subcategory,
        images: p.images || [],
        image: p.images && p.images.length > 0 ? p.images[0] : null,
        colors: p.colors || [],
        sizes: inventory.sizes,
        sizeInventory: inventory.sizeInventory,
        availableSizes: inventory.availableSizes,
        defaultSize: inventory.defaultSize,
        inStock: inventory.inStock,
        rating: p.rating || { rating: 4.5, reviews: 0 },
        isNewArrival: p.isNewArrival || false,
        isBestSeller: p.isBestSeller || false,
        isFeatured: p.isFeatured || false,
        details: p.details || {},
        saleInfo: p.saleInfo || null
      };
    });

    res.json({
      data: formattedProducts,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit))
    });
  } catch (err) {
    next(err);
  }
};

exports.get = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Not found' });
    const [productWithSale] = await attachSaleInfoToProducts([product.toObject({ flattenMaps: true })]);

    const inventory = buildProductInventoryPayload(productWithSale);
    res.json({
      id: productWithSale._id,
      _id: productWithSale._id,
      name: productWithSale.name,
      slug: productWithSale.slug,
      description: productWithSale.description,
      price: productWithSale.price,
      originalPrice: productWithSale.originalPrice,
      discount: productWithSale.discount,
      stock: inventory.stock,
      category: productWithSale.category,
      subcategory: productWithSale.subcategory,
      images: productWithSale.images || [],
      image: productWithSale.images && productWithSale.images.length > 0 ? productWithSale.images[0] : null,
      colors: productWithSale.colors || [],
      sizes: inventory.sizes,
      sizeInventory: inventory.sizeInventory,
      availableSizes: inventory.availableSizes,
      defaultSize: inventory.defaultSize,
      inStock: inventory.inStock,
      rating: productWithSale.rating || { rating: 4.5, reviews: 0 },
      isNewArrival: productWithSale.isNewArrival || false,
      isBestSeller: productWithSale.isBestSeller || false,
      isFeatured: productWithSale.isFeatured || false,
      details: productWithSale.details || {},
      keyFeatures: productWithSale.keyFeatures || [],
      saleInfo: productWithSale.saleInfo || null
    });
  } catch (err) {
    next(err);
  }
};

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
      const { getVisibilityFilter } = require('../utils/visibility')
      const exactMatch = await Product.find({
        _id: { $ne: id },
        category: currentProduct.category,
        subcategory: currentProduct.subcategory,
        ...getVisibilityFilter()
      }).limit(4)
      recommendations.push(...exactMatch)
    }
    
    // 2. Same category, different subcategory
    if (currentProduct.category && recommendations.length < limit) {
      const { getVisibilityFilter } = require('../utils/visibility')
      const categoryMatch = await Product.find({
        _id: { $ne: id },
        category: currentProduct.category,
        subcategory: { $ne: currentProduct.subcategory },
        ...getVisibilityFilter()
      }).limit(3)
      recommendations.push(...categoryMatch)
    }
    
    // 3. Similar price range (±30%)
    if (recommendations.length < limit) {
      const priceMin = currentProduct.price * 0.7
      const priceMax = currentProduct.price * 1.3
      const { getVisibilityFilter } = require('../utils/visibility')
      const priceMatch = await Product.find({
        _id: { $ne: id },
        price: { $gte: priceMin, $lte: priceMax },
        category: { $ne: currentProduct.category },
        ...getVisibilityFilter()
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
        const { getVisibilityFilter } = require('../utils/visibility')
        const keywordRegex = keywords.map(keyword => new RegExp(escapeRegex(keyword), 'i'))
        const descMatch = await Product.find({
          _id: { $ne: id },
          $or: keywordRegex.map(regex => ({ description: regex })),
          ...getVisibilityFilter()
        }).limit(2)
        recommendations.push(...descMatch)
      }
    }
    
    // 5. Fill remaining with popular/recent products
    if (recommendations.length < limit) {
      const { getVisibilityFilter } = require('../utils/visibility')
      const fallback = await Product.find({
        _id: { $ne: id },
        ...getVisibilityFilter()
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
        const inventory = buildProductInventoryPayload(product)
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
          sizes: inventory.sizes,
          sizeInventory: inventory.sizeInventory,
          availableSizes: inventory.availableSizes,
          defaultSize: inventory.defaultSize,
          rating: product.rating || { rating: 4.5, reviews: 0 },
          stock: inventory.stock,
          inStock: inventory.inStock
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
    const { getVisibilityFilter } = require('../utils/visibility')
    const filter = { 
      _id: { $nin: excludeIds ? excludeIds.split(',') : [] },
      ...getVisibilityFilter()
    }
    
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
    
    const formattedProducts = products.map(product => {
      const inventory = buildProductInventoryPayload(product)
      return ({
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
      sizes: inventory.sizes,
      sizeInventory: inventory.sizeInventory,
      availableSizes: inventory.availableSizes,
      defaultSize: inventory.defaultSize,
      rating: product.rating || { rating: 4.5, reviews: 0 },
      stock: inventory.stock,
      inStock: inventory.inStock
    })})
    
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
    clearHomeCache()
    res.status(201).json(product)
  } catch (err) {
    next(err)
  }
}

exports.update = async (req, res, next) => {
  try {
    const updated = await Product.findByIdAndUpdate(req.params.id, req.body, { returnDocument: 'after' })
    clearHomeCache()
    res.json(updated)
  } catch (err) {
    next(err)
  }
}

exports.remove = async (req, res, next) => {
  try {
    await Product.findByIdAndDelete(req.params.id)
    clearHomeCache()
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
}
