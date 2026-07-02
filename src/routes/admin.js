const express = require('express');
const router = express.Router();
const adminDashboardController = require('../controllers/adminDashboardController');
const adminProductController = require('../controllers/adminProductController');
const adminOrderController = require('../controllers/adminOrderController');
const adminUserController = require('../controllers/adminUserController');
const adminReportController = require('../controllers/adminReportController');
const adminManagerController = require('../controllers/adminManagerController');
const adminDeliveryController = require('../controllers/adminDeliveryController');
const adminDeliveryChargeController = require('../controllers/adminDeliveryChargeController');
const analyticsController = require('../controllers/analyticsController');
const advancedAnalyticsController = require('../controllers/advancedAnalyticsController');
const adminVoucherController = require('../controllers/adminVoucherController');
const notificationController = require('../controllers/notificationController');
const { verifyToken, requireAdmin, requireAnyRole, requireAdminOrManager } = require('../middleware/auth');

// All admin routes require authentication
router.use(verifyToken);

// Shorthand: admin OR manager
const adminOrManager = requireAnyRole('admin', 'manager');
// Shorthand: admin OR manager OR delivery_partner
const adminManagerOrDP = requireAnyRole('admin', 'manager', 'delivery_partner');

// Dashboard — accessible by admin & manager (same global data)
router.get('/dashboard/stats', adminOrManager, adminDashboardController.getDashboardStats);

// Products — accessible by admin & manager
router.get('/products', adminOrManager, adminProductController.listProducts);
router.get('/products/:id', adminOrManager, adminProductController.getProduct);
router.post('/products', adminOrManager, adminProductController.createProduct);
router.put('/products/:id', adminOrManager, adminProductController.updateProduct);
router.delete('/products/:id', requireAdmin, adminProductController.deleteProduct);

// Orders — accessible by admin, manager & delivery_partner
router.get('/orders', adminManagerOrDP, adminOrderController.listOrders);
router.get('/orders/:id', adminManagerOrDP, adminOrderController.getOrder);
router.get('/orders/:id/bill', requireAdminOrManager, adminOrderController.getOrderBill);
router.put('/orders/:id/status', adminManagerOrDP, adminOrderController.updateOrderStatus);
router.post('/orders/:id/accept', requireAnyRole('delivery_partner'), adminOrderController.acceptDelivery);

// Order Assignment — admin & manager
router.post('/orders/:id/assign', adminOrManager, adminOrderController.assignDeliveryPartner);
router.post('/orders/:id/unassign', adminOrManager, adminOrderController.unassignDeliveryPartner);

// Delivery Analytics — admin & manager
router.get('/delivery-analytics', adminOrManager, analyticsController.getDeliveryAnalytics);
router.get('/partner/:partnerId/stats', adminOrManager, analyticsController.getPartnerStats);

// Users — listing accessible by admin & manager; role changes admin only
router.get('/users', adminOrManager, adminUserController.getAllUsers);
router.get('/users/:userId', adminOrManager, adminUserController.getUserDetails);
router.put('/users/:userId', requireAdmin, adminUserController.updateUser);
router.delete('/users/:userId', requireAdmin, adminUserController.deleteUser);
router.put('/users/:userId/role', requireAdmin, adminUserController.changeUserRole);
router.post('/users/:userId/ban', requireAdmin, adminUserController.banUser);
router.post('/users/:userId/unban', requireAdmin, adminUserController.unbanUser);

// Area Manager Assignment — admin only
router.post('/area-managers', requireAdmin, adminManagerController.assignManagerToArea);
router.delete('/area-managers/:assignmentId', requireAdmin, adminManagerController.removeManagerFromArea);
router.get('/area-managers', adminOrManager, adminManagerController.getAreaManagerAssignments);

// Reports — admin & manager
router.get('/reports/best-sellers', adminOrManager, adminReportController.getBestSellers);
router.get('/reports/stats', adminOrManager, adminReportController.getReportStats);

// System Logs — admin only
router.get('/system-logs', requireAdmin, require('../controllers/systemLogsController').getSystemLogs);
router.get('/server-logs', requireAdmin, require('../controllers/serverLogsController').getServerLogs);

// Notifications — admin & manager
router.get('/notifications', adminOrManager, notificationController.listNotifications);
router.get('/notifications/unread-count', adminOrManager, notificationController.getUnreadCount);
router.patch('/notifications/read-all', adminOrManager, notificationController.markAllAsRead);
router.patch('/notifications/:id/read', adminOrManager, notificationController.markAsRead);

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

// Delivery Charge Configuration — accessible by admin & manager
router.get('/delivery-charge-config', adminOrManager, adminDeliveryChargeController.getDeliveryChargeConfig);
router.put('/delivery-charge-config', adminOrManager, adminDeliveryChargeController.updateDeliveryChargeConfig);

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
