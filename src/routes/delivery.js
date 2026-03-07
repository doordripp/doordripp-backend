/**
 * Delivery Partner Routes
 * All routes require delivery_partner or admin role
 */

const express = require('express');
const router = express.Router();
const deliveryController = require('../controllers/deliveryController');
const { verifyToken, requireAnyRole } = require('../middleware/auth');
const { uploadProofOfDelivery } = require('../middleware/upload');

// All delivery routes require authentication
router.use(verifyToken);

// ==================== MY ORDERS ====================
/**
 * GET /api/delivery/my-orders
 * Get orders assigned to logged-in delivery partner
 */
router.get('/my-orders', 
  requireAnyRole('delivery_partner', 'admin'), 
  deliveryController.getMyOrders
);

/**
 * GET /api/delivery/orders/:id
 * Get specific order details (must be assigned to me)
 */
router.get('/orders/:id',
  requireAnyRole('delivery_partner', 'admin'),
  deliveryController.getMyOrders // Uses same controller with ID filter
);

/**
 * PUT /api/delivery/orders/:id/status
 * Update order status (packed, processing, shipped, delivered)
 */
router.put('/orders/:id/status',
  requireAnyRole('delivery_partner', 'admin'),
  deliveryController.updateOrderStatus
);

// ==================== LOCATION TRACKING ====================
/**
 * POST /api/delivery/location
 * Update current location for an order
 */
router.post('/location',
  requireAnyRole('delivery_partner', 'admin'),
  deliveryController.updateLocation
);

/**
 * GET /api/delivery/orders/:id/location-history
 * Get location history for an order
 */
router.get('/orders/:id/location-history',
  requireAnyRole('delivery_partner', 'admin'),
  deliveryController.getLocationHistory
);

// ==================== PROOF OF DELIVERY ====================
/**
 * POST /api/delivery/orders/:id/proof
 * Upload proof of delivery photo
 */
router.post('/orders/:id/proof',
  requireAnyRole('delivery_partner', 'admin'),
  uploadProofOfDelivery.single('photo'),
  deliveryController.uploadProofOfDelivery
);

/**
 * POST /api/delivery/orders/:id/accept
 * Accept delivery assignment
 */
router.post('/orders/:id/accept',
  requireAnyRole('delivery_partner', 'admin'),
  deliveryController.acceptDelivery
);

module.exports = router;
