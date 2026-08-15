const mongoose = require('mongoose')
const Product = require('../models/Product')
const escapeRegex = require('../utils/escapeRegex')
const { attachSaleInfoToProducts } = require('../utils/promotionHelpers')
const { buildProductInventoryPayload } = require('../utils/productInventory')

const { 
  getPrecomputedHomePayload, 
  refreshHomeProductsPrecomputation, 
  getSectionTop8Ids 
} = require('../services/homePrecomputeService')

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
    const { 
      search, 
      category, 
      gender,
      subcategory, 
      subcategories,
      minPrice,
      maxPrice,
      priceRange,
      sizes,
      sort, 
      page = 1, 
      limit = 50, 
      isNewArrival, 
      isBestSeller, 
      isFeatured,
      collection 
    } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 50);
    const skip = (pageNum - 1) * limitNum;

    const filter = {};
    const targetCategory = category || gender;

    // Normalizing collection flags
    const normCollection = String(collection || '').toLowerCase().trim();
    const isNewArrivalFlag = isNewArrival === 'true' || isNewArrival === true || normCollection === 'new-arrivals' || normCollection === 'newarrivals';
    const isBestSellerFlag = isBestSeller === 'true' || isBestSeller === true || normCollection === 'best-sellers' || normCollection === 'bestsellers' || normCollection === 'top-selling';
    const isFeaturedFlag = isFeatured === 'true' || isFeatured === true || normCollection === 'featured' || normCollection === 'featured-products' || normCollection === 'popular-products';

    // Delegate to search service for intelligent search
    if (search) {
      const searchService = require('../services/searchService')
      const searchResults = await searchService.search(search, {
        category: targetCategory || 'All',
        subcategory: subcategory || subcategories,
        sort,
        page: pageNum,
        limit: limitNum,
        isNewArrival: isNewArrivalFlag,
        isBestSeller: isBestSellerFlag,
        isFeatured: isFeaturedFlag
      })
      return res.json(searchResults)
    }

    if (isNewArrivalFlag) filter.isNewArrival = true;
    if (isBestSellerFlag) filter.isBestSeller = true;
    if (isFeaturedFlag) filter.isFeatured = true;

    // Multi-subcategory support
    const rawSubcats = subcategories || subcategory;
    if (rawSubcats) {
      const subcatList = (Array.isArray(rawSubcats) ? rawSubcats : String(rawSubcats).split(','))
        .map(s => s.trim())
        .filter(Boolean);
      if (subcatList.length === 1) {
        filter.subcategory = new RegExp(`^${escapeRegex(subcatList[0])}$`, 'i');
      } else if (subcatList.length > 1) {
        filter.subcategory = { $in: subcatList.map(s => new RegExp(`^${escapeRegex(s)}$`, 'i')) };
      }
    }

    // Category / Gender filtering
    if (targetCategory && targetCategory !== 'All' && targetCategory !== 'all') {
      const catLower = targetCategory.toLowerCase();
      if (catLower === 'men') {
        filter.category = { $regex: /^(men|both|unisex|both \(men & women\))$/i };
      } else if (catLower === 'women') {
        filter.category = { $regex: /^(women|both|unisex|both \(men & women\))$/i };
      } else if (catLower === 'both' || catLower.includes('both')) {
        filter.category = { $regex: /^(both|unisex|both \(men & women\))$/i };
      } else {
        filter.category = new RegExp(`^${escapeRegex(targetCategory)}$`, 'i');
      }
    }

    // Price range filtering
    let minP = minPrice !== undefined && minPrice !== '' ? Number(minPrice) : undefined;
    let maxP = maxPrice !== undefined && maxPrice !== '' ? Number(maxPrice) : undefined;
    if (priceRange && typeof priceRange === 'string' && priceRange.includes('-')) {
      const [pMin, pMax] = priceRange.split('-').map(Number);
      if (!isNaN(pMin)) minP = pMin;
      if (!isNaN(pMax)) maxP = pMax;
    }
    if ((minP !== undefined && !isNaN(minP)) || (maxP !== undefined && !isNaN(maxP))) {
      filter.price = {};
      if (minP !== undefined && !isNaN(minP)) filter.price.$gte = minP;
      if (maxP !== undefined && !isNaN(maxP)) filter.price.$lte = maxP;
    }

    // Sizes filtering
    if (sizes) {
      const sizeList = (Array.isArray(sizes) ? sizes : String(sizes).split(','))
        .map(s => s.trim())
        .filter(Boolean);
      if (sizeList.length > 0) {
        filter.sizes = { $in: sizeList.map(s => new RegExp(`^${escapeRegex(s)}$`, 'i')) };
      }
    }

    const { getVisibilityFilter } = require('../utils/visibility');
    Object.assign(filter, getVisibilityFilter());

    let sortOption = { createdAt: -1 };
    if (sort === 'price-low') sortOption = { price: 1 };
    else if (sort === 'price-high') sortOption = { price: -1 };
    else if (sort === 'name') sortOption = { name: 1 };
    else if (sort === 'rating') sortOption = { 'rating.rating': -1, createdAt: -1 };

    // Determine if this is a default collection/category view where we prioritize the top 8 Home UI items
    const isDefaultSort = !sort || sort === 'newest';
    const hasCustomFilter = Boolean(rawSubcats || (minP !== undefined && !isNaN(minP)) || (maxP !== undefined && !isNaN(maxP)) || sizes);
    
    let sectionName = null;
    if (isNewArrivalFlag) sectionName = 'new-arrivals';
    else if (isBestSellerFlag) sectionName = 'best-sellers';
    else if (isFeaturedFlag) sectionName = 'featured';
    else if (targetCategory && targetCategory.toLowerCase() === 'accessories') sectionName = 'accessories';

    const top8Ids = (isDefaultSort && !hasCustomFilter && sectionName) ? getSectionTop8Ids(sectionName) : [];

    let products = [];
    let total = 0;

    if (top8Ids.length > 0) {
      total = await Product.countDocuments(filter);

      if (pageNum === 1) {
        // Fetch top 8 items matching filter
        const top8Raw = await Product.find({ ...filter, _id: { $in: top8Ids } }).lean();
        // Preserve top 8 ordering
        const top8Map = new Map(top8Raw.map(p => [String(p._id), p]));
        const orderedTop8 = top8Ids.map(id => top8Map.get(String(id))).filter(Boolean);

        const foundTop8Ids = new Set(orderedTop8.map(p => String(p._id)));
        const remainingNeeded = limitNum - orderedTop8.length;

        let remainingProducts = [];
        if (remainingNeeded > 0) {
          remainingProducts = await Product.find({ ...filter, _id: { $nin: Array.from(foundTop8Ids) } })
            .sort({ createdAt: -1 })
            .limit(remainingNeeded)
            .lean();
        }

        products = [...orderedTop8, ...remainingProducts];
      } else {
        // For page > 1, offset by top8 count
        const skipOffset = (pageNum - 1) * limitNum - top8Ids.length;
        products = await Product.find({ ...filter, _id: { $nin: top8Ids } })
          .sort({ createdAt: -1 })
          .skip(Math.max(0, skipOffset))
          .limit(limitNum)
          .lean();
      }
    } else {
      // Standard database query (for custom sort/search/filter or generic catalogue)
      const [rawProducts, rawTotal] = await Promise.all([
        Product.find(filter).skip(skip).limit(limitNum).sort(sortOption).lean(),
        Product.countDocuments(filter)
      ]);
      products = rawProducts;
      total = rawTotal;
    }

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
      page: pageNum,
      totalPages: Math.ceil(total / limitNum)
    });
  } catch (err) {
    next(err);
  }
};

exports.get = async (req, res, next) => {
  try {
    const identifier = req.params.id;
    let product = null;
    if (mongoose.Types.ObjectId.isValid(identifier)) {
      product = await Product.findById(identifier);
    }
    if (!product) {
      product = await Product.findOne({ slug: identifier });
    }
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
    const { id: identifier } = req.params
    const { limit = 8 } = req.query
    
    // Get the current product by ID or slug
    let currentProduct = null;
    if (mongoose.Types.ObjectId.isValid(identifier)) {
      currentProduct = await Product.findById(identifier);
    }
    if (!currentProduct) {
      currentProduct = await Product.findOne({ slug: identifier });
    }
    if (!currentProduct) {
      return res.status(404).json({ error: 'Product not found' })
    }
    const id = currentProduct._id;

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
      const keywords = currentProduct.description
        .toLowerCase()
        .split(/\s+/)
        .filter(word => word.length > 3)
        .slice(0, 5)
      
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
      .sort({ createdAt: -1 })
      .limit(limit - recommendations.length)
      
      recommendations.push(...fallback)
    }
    
    // Remove duplicates and limit results
    const uniqueProducts = []
    const seenIds = new Set([id])
    
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
    next(err)
  }
}

// Get smart recommendations for cart/general use
exports.getRecommendations = async (req, res, next) => {
  try {
    const { excludeIds, categories, subcategories, limit = 10 } = req.query
    const { getVisibilityFilter } = require('../utils/visibility')
    const filter = { 
      _id: { $nin: excludeIds ? excludeIds.split(',') : [] },
      ...getVisibilityFilter()
    }
    
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
      .limit(parseInt(limit, 10) || 10)
    
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
      })
    })
    
    res.json({
      success: true,
      recommendations: formattedProducts,
      count: formattedProducts.length
    })
    
  } catch (err) {
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
