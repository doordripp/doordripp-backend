/**
 * Delivery Partner Routes
 * Protected routes for delivery partner operations
 */

const express = require('express');
const router = express.Router();
const deliveryPartnerController = require('../controllers/deliveryPartnerController');
const { verifyToken, requireRole } = require('../middleware/auth');

// All routes require authentication and delivery_partner role
router.use(verifyToken);
router.use(requireRole('delivery_partner'));

// Get all orders assigned to delivery partner
router.get('/orders', deliveryPartnerController.getMyOrders);

// Get single order details
router.get('/orders/:orderId', deliveryPartnerController.getOrderDetails);

// Update order status
router.patch('/orders/:orderId/status', deliveryPartnerController.updateOrderStatus);

// Get delivery partner statistics
router.get('/stats', deliveryPartnerController.getStats);

module.exports = router;
