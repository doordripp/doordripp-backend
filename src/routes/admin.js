const express = require('express');
const router = express.Router();
const adminController = require('../controllers/mongoAdminController');
const adminDeliveryController = require('../controllers/adminDeliveryController');
const { verifyToken, requireAdmin, requireAnyRole } = require('../middleware/auth');

// All admin routes require authentication
router.use(verifyToken);

// Dashboard
router.get('/dashboard/stats', requireAdmin, adminController.getDashboardStats);

// Products
router.get('/products', requireAdmin, adminController.listProducts);
router.get('/products/:id', requireAdmin, adminController.getProduct);
router.post('/products', requireAdmin, adminController.createProduct);
router.put('/products/:id', requireAdmin, adminController.updateProduct);
router.delete('/products/:id', requireAdmin, adminController.deleteProduct);

// Orders
router.get('/orders', requireAnyRole('admin', 'delivery_partner'), adminController.listOrders);
router.get('/orders/:id', requireAnyRole('admin', 'delivery_partner'), adminController.getOrder);
router.put('/orders/:id/status', requireAnyRole('admin', 'delivery_partner'), adminController.updateOrderStatus);
router.post('/orders/:id/accept', requireAnyRole('delivery_partner'), adminController.acceptDelivery);

// Users
router.get('/users', requireAdmin, adminController.getAllUsers);
router.get('/users/:userId', requireAdmin, adminController.getUserDetails);
router.put('/users/:userId/role', requireAdmin, adminController.changeUserRole);
router.post('/users/:userId/ban', requireAdmin, adminController.banUser);
router.post('/users/:userId/unban', requireAdmin, adminController.unbanUser);

// Area Manager Assignment
router.post('/area-managers', requireAdmin, adminController.assignManagerToArea);
router.delete('/area-managers/:assignmentId', requireAdmin, adminController.removeManagerFromArea);
router.get('/area-managers', requireAdmin, adminController.getAreaManagerAssignments);

// Reports
router.get('/reports/best-sellers', requireAdmin, adminController.getBestSellers);

// Delivery Zones Management
router.post('/delivery-zones', requireAdmin, adminDeliveryController.createDeliveryZone);
router.get('/delivery-zones', requireAdmin, adminDeliveryController.getAllDeliveryZones);
router.get('/delivery-zones/stats', requireAdmin, adminDeliveryController.getDeliveryZoneStats);
router.get('/delivery-zones/:id', requireAdmin, adminDeliveryController.getDeliveryZoneById);
router.put('/delivery-zones/:id', requireAdmin, adminDeliveryController.updateDeliveryZone);
router.delete('/delivery-zones/:id', requireAdmin, adminDeliveryController.deleteDeliveryZone);
router.patch('/delivery-zones/:id/toggle', requireAdmin, adminDeliveryController.toggleZoneStatus);

module.exports = router;
