const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const { optionalVerifyToken } = require('../middleware/auth');

// Public routes - fetch products
router.get('/', optionalVerifyToken, productController.list);

// Get smart recommendations (for cart, homepage, etc.) - Must be BEFORE /:id route
router.get('/recommendations/smart', productController.getRecommendations);

router.get('/:id', productController.get);

// Get related products for a specific product
router.get('/:id/related', productController.getRelatedProducts);

module.exports = router;
