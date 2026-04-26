const express = require('express')
const router = express.Router()
const marketingController = require('../controllers/marketingController')
const { verifyToken, requireAdmin } = require('../middleware/auth')

// Public routes
router.get('/sales/active', marketingController.getActiveSales)
router.get('/sales/:identifier', marketingController.getSale)
router.get('/sales/:identifier/products', marketingController.getSaleProductsByIdentifier)
router.get('/popup', marketingController.getActivePopup)

// Admin routes
router.get('/admin/sales', verifyToken, requireAdmin, marketingController.listSales)
router.post('/admin/sales', verifyToken, requireAdmin, marketingController.createSale)
router.put('/admin/sales/:id', verifyToken, requireAdmin, marketingController.updateSale)
router.patch('/admin/sales/:id/status', verifyToken, requireAdmin, marketingController.toggleSaleStatus)
router.delete('/admin/sales/:id', verifyToken, requireAdmin, marketingController.deleteSale)

router.get('/admin/popups', verifyToken, requireAdmin, marketingController.listPopups)
router.post('/admin/popups', verifyToken, requireAdmin, marketingController.createPopup)
router.put('/admin/popups/:id', verifyToken, requireAdmin, marketingController.updatePopup)
router.patch('/admin/popups/:id/status', verifyToken, requireAdmin, marketingController.togglePopupStatus)
router.delete('/admin/popups/:id', verifyToken, requireAdmin, marketingController.deletePopup)

module.exports = router
