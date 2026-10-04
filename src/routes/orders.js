const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const InvoiceController = require('../controllers/invoiceController');
const { verifyToken } = require('../middleware/auth');

// Customer endpoints
router.get('/razorpay-config', verifyToken, orderController.getRazorpayConfig);
router.post('/', verifyToken, orderController.create);
router.get('/:id', verifyToken, orderController.get);
router.get('/:id/invoice', verifyToken, InvoiceController.getOrderInvoiceLink);
router.post('/:id/verify-payment', verifyToken, orderController.verifyPayment);
router.post('/:id/payment-failed', verifyToken, orderController.markPaymentFailed);
router.post('/:id/cancel', verifyToken, orderController.cancel);

// Admin endpoints
router.get('/', verifyToken, orderController.list);
router.patch('/:id/status', verifyToken, orderController.updateStatus);
router.patch('/:id/cod-collected', verifyToken, orderController.markCodCollected);

module.exports = router;
