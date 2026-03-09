const express = require('express')
const router = express.Router()
const contentController = require('../controllers/contentController')
const { verifyToken, requireAdmin } = require('../middleware/auth')

// Public routes
router.get('/categories', contentController.getCategories)
router.get('/banners', contentController.getBanners)

// Admin-only routes
router.post('/categories', verifyToken, requireAdmin, contentController.createCategory)
router.patch('/categories/:id', verifyToken, requireAdmin, contentController.updateCategoryStatus)
router.delete('/categories/:id', verifyToken, requireAdmin, contentController.deleteCategory)

// Banner routes (Admin-only for mutations)
router.post('/banners', verifyToken, requireAdmin, contentController.createBanner)
router.patch('/banners/:id', verifyToken, requireAdmin, contentController.updateStatus)
router.put('/banners/:id', verifyToken, requireAdmin, contentController.updateBanner)
router.delete('/banners/:id', verifyToken, requireAdmin, contentController.deleteBanner)

module.exports = router;
