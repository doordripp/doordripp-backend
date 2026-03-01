const express = require('express')
const router = express.Router()
const contentController = require('../controllers/contentController')
const { verifyToken, requireAdmin } = require('../middleware/auth')

// Public routes
router.get('/banners', contentController.getBanners)
router.get('/categories', contentController.getCategories)

// Admin-only routes
router.post('/banners', verifyToken, requireAdmin, contentController.createBanner)
router.patch('/banners/:id', verifyToken, requireAdmin, contentController.updateStatus)
router.delete('/banners/:id', verifyToken, requireAdmin, contentController.deleteBanner)

router.post('/categories', verifyToken, requireAdmin, contentController.createCategory)
router.patch('/categories/:id', verifyToken, requireAdmin, contentController.updateCategoryStatus)
router.delete('/categories/:id', verifyToken, requireAdmin, contentController.deleteCategory)

module.exports = router;
