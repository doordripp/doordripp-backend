/**
 * Trial Room Routes
 * 
 * Endpoints:
 * - POST /api/trial-room/create - Create trial order
 * - GET /api/trial-room/check-today - Check daily usage
 * - GET /api/trial-room/history - Get user's trial history
 * - GET /api/trial-room/:id - Get specific trial
 * - POST /api/trial-room/:id/convert - Convert to order
 * - POST /api/trial-room/:id/cancel - Cancel trial
 * - GET /api/trial-room/admin/list - Admin: list all trials
 * - GET /api/trial-room/admin/analytics - Admin: get analytics
 */

const express = require('express');
const router = express.Router();
const { verifyToken, requireAdmin } = require('../middleware/auth');
const trialRoomController = require('../controllers/trialRoomController');

/**
 * ============ USER ROUTES (Authenticated) ============
 */

/**
 * POST /api/trial-room/create
 * Create a new trial order
 * @requires Authentication
 */
router.post('/create', verifyToken, trialRoomController.createTrialOrder);

/**
 * GET /api/trial-room/check-today
 * Check if user has used trial today
 * @requires Authentication
 */
router.get('/check-today', verifyToken, trialRoomController.checkDailyUsage);

/**
 * GET /api/trial-room/history
 * Get user's trial history
 * @requires Authentication
 * @query page, limit, status
 */
router.get('/history', verifyToken, trialRoomController.getTrialHistory);

/**
 * GET /api/trial-room/:id
 * Get specific trial order
 * @requires Authentication
 */
router.get('/:id', verifyToken, trialRoomController.getTrialOrder);

/**
 * POST /api/trial-room/:id/convert
 * Convert trial to order after payment
 * @requires Authentication
 */
router.post('/:id/convert', verifyToken, trialRoomController.convertTrialToOrder);

/**
 * POST /api/trial-room/:id/cancel
 * Cancel a trial order
 * @requires Authentication
 */
router.post('/:id/cancel', verifyToken, trialRoomController.cancelTrialOrder);

/**
 * ============ ADMIN ROUTES (Authenticated + Admin) ============
 */

/**
 * GET /api/trial-room/admin/list
 * List all trial orders
 * @requires Authentication + Admin role
 * @query page, limit, status
 */
router.get('/admin/list', verifyToken, requireAdmin, trialRoomController.adminListTrials);

/**
 * GET /api/trial-room/admin/analytics
 * Get trial room analytics
 * @requires Authentication + Admin role
 */
router.get('/admin/analytics', verifyToken, requireAdmin, trialRoomController.adminGetAnalytics);

module.exports = router;
