const express = require('express');
const router = express.Router();
const adminOrderController = require('../controllers/adminOrderController');
const adminManagerController = require('../controllers/adminManagerController');
const { verifyToken, requireAnyRole } = require('../middleware/auth');

// All manager routes require authentication
router.use(verifyToken);

// ==================== SELF-SERVICE (any authenticated user) ====================

/**
 * GET /api/manager/delivery-partners/me/schedule
 */
router.get('/delivery-partners/me/schedule', adminManagerController.getPartnerSchedule);

/**
 * PUT /api/manager/delivery-partners/me/schedule
 */
router.put('/delivery-partners/me/schedule', adminManagerController.updatePartnerSchedule);

// ==================== ADMIN/MANAGER ROUTES ====================
router.use(requireAnyRole('admin', 'manager'));

/**
 * GET /api/manager/delivery-partners
 */
router.get('/delivery-partners', adminManagerController.getAllDeliveryPartners);

/**
 * POST /api/manager/delivery-partners
 */
router.post('/delivery-partners', adminManagerController.createDeliveryPartner);

/**
 * GET /api/manager/delivery-partners/:id
 */
router.get('/delivery-partners/:id', adminManagerController.getDeliveryPartnerById);

/**
 * PUT /api/manager/delivery-partners/:id
 */
router.put('/delivery-partners/:id', adminManagerController.updateDeliveryPartner);

/**
 * DELETE /api/manager/delivery-partners/:id
 */
router.delete('/delivery-partners/:id', adminManagerController.deleteDeliveryPartner);

/**
 * POST /api/manager/delivery-partners/:id/assign-order
 */
router.post('/delivery-partners/:id/assign-order', adminManagerController.assignDeliveryPartnerWrap);

/**
 * DELETE /api/manager/delivery-partners/:id/unassign-order/:orderId
 */
router.delete('/delivery-partners/:id/unassign-order/:orderId', async (req, res, next) => {
  req.params = { ...req.params, id: req.params.orderId };
  return adminOrderController.unassignDeliveryPartner(req, res, next);
});

module.exports = router;
