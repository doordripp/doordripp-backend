const express = require('express');
const router = express.Router();
const adminController = require('../controllers/mongoAdminController');
const adminDeliveryController = require('../controllers/adminDeliveryController');
const { verifyToken, requireAdmin } = require('../middleware/auth');

// All admin routes require authentication and admin role
router.use(verifyToken);
router.use(requireAdmin);

// Dashboard
router.get('/dashboard/stats', adminController.getDashboardStats);

// Products
router.get('/products', adminController.listProducts);
router.get('/products/:id', adminController.getProduct);
router.post('/products', adminController.createProduct);
router.put('/products/:id', adminController.updateProduct);
router.delete('/products/:id', adminController.deleteProduct);

// Orders
router.get('/orders', adminController.listOrders);
router.get('/orders/:id', adminController.getOrder);
router.put('/orders/:id/status', adminController.updateOrderStatus);

// Users
router.get('/users', adminController.getAllUsers);
router.get('/users/:userId', adminController.getUserDetails);
router.put('/users/:userId/role', adminController.changeUserRole);
router.post('/users/:userId/ban', adminController.banUser);
router.post('/users/:userId/unban', adminController.unbanUser);

// Area Manager Assignment
router.post('/area-managers', adminController.assignManagerToArea);
router.delete('/area-managers/:assignmentId', adminController.removeManagerFromArea);
router.get('/area-managers', adminController.getAreaManagerAssignments);

// Reports
router.get('/reports/best-sellers', adminController.getBestSellers);

// Delivery Zones Management
router.post('/delivery-zones', adminDeliveryController.createDeliveryZone);
router.get('/delivery-zones', adminDeliveryController.getAllDeliveryZones);
router.get('/delivery-zones/stats', adminDeliveryController.getDeliveryZoneStats);
router.get('/delivery-zones/:id', adminDeliveryController.getDeliveryZoneById);
router.put('/delivery-zones/:id', adminDeliveryController.updateDeliveryZone);
router.delete('/delivery-zones/:id', adminDeliveryController.deleteDeliveryZone);
router.patch('/delivery-zones/:id/toggle', adminDeliveryController.toggleZoneStatus);

module.exports = router;
