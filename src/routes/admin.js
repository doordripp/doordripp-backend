const express = require('express');
const router = express.Router();
const adminController = require('../controllers/mongoAdminController');
const adminDeliveryController = require('../controllers/adminDeliveryController');
const analyticsController = require('../controllers/analyticsController');
const advancedAnalyticsController = require('../controllers/advancedAnalyticsController');
const adminVoucherController = require('../controllers/adminVoucherController');
const { verifyToken, requireAdmin, requireAnyRole } = require('../middleware/auth');

// All admin routes require authentication
router.use(verifyToken);

// Shorthand: admin OR manager
const adminOrManager = requireAnyRole('admin', 'manager');
// Shorthand: admin OR manager OR delivery_partner
const adminManagerOrDP = requireAnyRole('admin', 'manager', 'delivery_partner');

// Dashboard — accessible by admin & manager (same global data)
router.get('/dashboard/stats', adminOrManager, adminController.getDashboardStats);

// Products — accessible by admin & manager
router.get('/products', adminOrManager, adminController.listProducts);
router.get('/products/:id', adminOrManager, adminController.getProduct);
router.post('/products', adminOrManager, adminController.createProduct);
router.put('/products/:id', adminOrManager, adminController.updateProduct);
router.delete('/products/:id', requireAdmin, adminController.deleteProduct);

// Orders — accessible by admin, manager & delivery_partner
router.get('/orders', adminManagerOrDP, adminController.listOrders);
router.get('/orders/:id', adminManagerOrDP, adminController.getOrder);
router.put('/orders/:id/status', adminManagerOrDP, adminController.updateOrderStatus);
router.post('/orders/:id/accept', requireAnyRole('delivery_partner'), adminController.acceptDelivery);

// Order Assignment — admin & manager
router.post('/orders/:id/assign', adminOrManager, adminController.assignDeliveryPartner);
router.post('/orders/:id/unassign', adminOrManager, adminController.unassignDeliveryPartner);

// Delivery Analytics — admin & manager
router.get('/delivery-analytics', adminOrManager, analyticsController.getDeliveryAnalytics);
router.get('/partner/:partnerId/stats', adminOrManager, analyticsController.getPartnerStats);

// Users — listing accessible by admin & manager; role changes admin only
router.get('/users', adminOrManager, adminController.getAllUsers);
router.get('/users/:userId', adminOrManager, adminController.getUserDetails);
router.put('/users/:userId', requireAdmin, adminController.updateUser);
router.delete('/users/:userId', requireAdmin, adminController.deleteUser);
router.put('/users/:userId/role', requireAdmin, adminController.changeUserRole);
router.post('/users/:userId/ban', requireAdmin, adminController.banUser);
router.post('/users/:userId/unban', requireAdmin, adminController.unbanUser);

// Area Manager Assignment — admin only
router.post('/area-managers', requireAdmin, adminController.assignManagerToArea);
router.delete('/area-managers/:assignmentId', requireAdmin, adminController.removeManagerFromArea);
router.get('/area-managers', adminOrManager, adminController.getAreaManagerAssignments);

// Reports — admin & manager
router.get('/reports/best-sellers', adminOrManager, adminController.getBestSellers);
router.get('/reports/stats', adminOrManager, adminController.getReportStats);

// Vouchers / Coupons — admin only
router.get('/vouchers', requireAdmin, adminVoucherController.listVouchers);
router.post('/vouchers', requireAdmin, adminVoucherController.createVoucher);
router.patch('/vouchers/:id/toggle', requireAdmin, adminVoucherController.toggleVoucherStatus);

// Delivery Zones Management — accessible by admin & manager
router.post('/delivery-zones', adminOrManager, adminDeliveryController.createDeliveryZone);
router.get('/delivery-zones', adminOrManager, adminDeliveryController.getAllDeliveryZones);
router.get('/delivery-zones/stats', adminOrManager, adminDeliveryController.getDeliveryZoneStats);
router.get('/delivery-zones/:id', adminOrManager, adminDeliveryController.getDeliveryZoneById);
router.put('/delivery-zones/:id', adminOrManager, adminDeliveryController.updateDeliveryZone);
router.delete('/delivery-zones/:id', requireAdmin, adminDeliveryController.deleteDeliveryZone);
router.patch('/delivery-zones/:id/toggle', adminOrManager, adminDeliveryController.toggleZoneStatus);

// ============================================
// ADVANCED ANALYTICS ENDPOINTS — admin & manager
// ============================================

// Marketing Analytics
router.get('/analytics/customer-acquisition', adminOrManager, advancedAnalyticsController.getCustomerAcquisition);
router.get('/analytics/campaign-performance', adminOrManager, advancedAnalyticsController.getCampaignPerformance);
router.get('/analytics/conversion-funnel', adminOrManager, advancedAnalyticsController.getConversionFunnel);

// Product Analytics
router.get('/analytics/product-performance', adminOrManager, advancedAnalyticsController.getProductPerformance);

// Financial Analytics
router.get('/analytics/revenue', adminOrManager, advancedAnalyticsController.getRevenue);
router.get('/analytics/profit-loss', adminOrManager, advancedAnalyticsController.getProfitLoss);
router.get('/analytics/cash-flow', adminOrManager, advancedAnalyticsController.getCashFlow);
router.get('/analytics/unit-economics', adminOrManager, advancedAnalyticsController.getUnitEconomics);

// Comprehensive Report & Dashboard
router.get('/analytics/comprehensive-report', adminOrManager, advancedAnalyticsController.getComprehensiveReport);
router.get('/analytics/dashboard', adminOrManager, advancedAnalyticsController.getDashboardMetrics);

module.exports = router;
