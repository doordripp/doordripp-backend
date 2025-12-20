const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { verifyToken } = require('../middleware/auth');

// Customer endpoints
router.post('/', verifyToken, orderController.create);
router.get('/:id', verifyToken, orderController.get);
router.post('/:id/verify-payment', verifyToken, orderController.verifyPayment);
router.post('/:id/cancel', verifyToken, orderController.cancel);

// Admin endpoints
router.get('/', verifyToken, orderController.list);
router.patch('/:id/status', verifyToken, orderController.updateStatus);

module.exports = router;
