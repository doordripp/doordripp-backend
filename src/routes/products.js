const express = require('express');
const router = express.Router();
const Product = require('../models/Product');
const { verifyToken, requireAdmin, optionalVerifyToken, hasAnyRole } = require('../middleware/auth');

// Public routes - fetch products
router.get('/', optionalVerifyToken, async (req, res, next) => {
  try {
    const { search, category, sort, page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const filter = {};
    if (search) {
      filter.$or = [
        { name: new RegExp(search, 'i') },
        { description: new RegExp(search, 'i') }
      ];
    }
    if (category && category !== 'All') {
      filter.category = new RegExp(`^${category}$`, 'i');
    }

    const { getVisibilityFilter } = require('../utils/visibility');
    Object.assign(filter, getVisibilityFilter());

    let sortOption = { createdAt: -1 };
    if (sort === 'price-low') sortOption = { price: 1 };
    else if (sort === 'price-high') sortOption = { price: -1 };
    else if (sort === 'name') sortOption = { name: 1 };

    const [products, total] = await Promise.all([
      Product.find(filter).skip(skip).limit(parseInt(limit)).sort(sortOption),
      Product.countDocuments(filter)
    ]);

    const formattedProducts = products.map(p => ({
      id: p._id,
      _id: p._id,
      name: p.name,
      slug: p.slug,
      description: p.description,
      price: p.price,
      originalPrice: p.originalPrice,
      discount: p.discount,
      stock: p.stock,
      category: p.category,
      subcategory: p.subcategory,
      images: p.images || [],
      image: p.images && p.images.length > 0 ? p.images[0] : null,
      colors: p.colors || [],
      sizes: p.sizes || [],
      rating: p.rating || { rating: 4.5, reviews: 0 },
      isNewArrival: p.isNewArrival || false,
      isBestSeller: p.isBestSeller || false,
      isFeatured: p.isFeatured || false
    }));

    res.json({
      data: formattedProducts,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit))
    });
  } catch (err) {
    next(err);
  }
});

// Get smart recommendations (for cart, homepage, etc.) - Must be BEFORE /:id route
router.get('/recommendations/smart', async (req, res, next) => {
  try {
    const productController = require('../controllers/productController');
    await productController.getRecommendations(req, res, next);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Not found' });

    // No visibility restriction on detail viewing to allow customers to browse
    // even during closed hours. We handle checkout restrictions separately.

    res.json({
      id: product._id,
      _id: product._id,
      name: product.name,
      slug: product.slug,
      description: product.description,
      price: product.price,
      originalPrice: product.originalPrice,
      discount: product.discount,
      stock: product.stock,
      category: product.category,
      subcategory: product.subcategory,
      images: product.images || [],
      image: product.images && product.images.length > 0 ? product.images[0] : null,
      colors: product.colors || [],
      sizes: product.sizes || [],
      rating: product.rating || { rating: 4.5, reviews: 0 },
      isNewArrival: product.isNewArrival || false,
      isBestSeller: product.isBestSeller || false,
      isFeatured: product.isFeatured || false,
      details: product.details || {},
      keyFeatures: product.keyFeatures || []
    });
  } catch (err) {
    next(err);
  }
});

// Get related products for a specific product
router.get('/:id/related', async (req, res, next) => {
  try {
    const productController = require('../controllers/productController');
    await productController.getRelatedProducts(req, res, next);
  } catch (err) {
    next(err);
  }
});

// Admin routes
router.post('/', verifyToken, requireAdmin, async (req, res, next) => {
  try {
    const { name, description, price, stock, category, images } = req.body;

    const slug = name.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') +
      '-' + Date.now().toString(36);

    const product = new Product({
      name,
      slug,
      description: description || '',
      price: parseFloat(price),
      stock: parseInt(stock) || 0,
      category: category || 'Uncategorized',
      images: images || []
    });

    await product.save();
    res.status(201).json({ ...product.toObject(), id: product._id });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', verifyToken, requireAdmin, async (req, res, next) => {
  try {
    const { name, description, price, stock, category, images } = req.body;
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (price !== undefined) updateData.price = parseFloat(price);
    if (stock !== undefined) updateData.stock = parseInt(stock);
    if (category !== undefined) updateData.category = category;
    if (images !== undefined) updateData.images = images;

    const product = await Product.findByIdAndUpdate(req.params.id, updateData, { new: true });
    if (!product) return res.status(404).json({ error: 'Not found' });
    res.json({ ...product.toObject(), id: product._id });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', verifyToken, requireAdmin, async (req, res, next) => {
  try {
    await Product.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
