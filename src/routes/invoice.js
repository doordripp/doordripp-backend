const express = require('express');
const router = express.Router();
const InvoiceController = require('../controllers/invoiceController');
const { verifyToken, requireAdmin } = require('../middleware/auth');

/**
 * Invoice Routes
 * All routes require authentication
 */

// Generate invoice for an order
router.post(
  '/generate/:orderId',
  verifyToken,
  requireAdmin,
  InvoiceController.generateInvoice
);

// Get current financial year
router.get(
  '/financial-year/current',
  verifyToken,
  InvoiceController.getCurrentFinancialYear
);

// Get invoice by invoice number
router.get(
  '/number/:invoiceNumber',
  verifyToken,
  InvoiceController.getInvoiceByNumber
);

// Get invoice by order ID
router.get(
  '/order/:orderId',
  verifyToken,
  InvoiceController.getInvoiceByOrder
);

// Download invoice PDF
router.get(
  '/:invoiceId/download',
  verifyToken,
  InvoiceController.downloadInvoice
);

// Get invoice by ID
router.get(
  '/:invoiceId',
  verifyToken,
  InvoiceController.getInvoice
);

// List invoices (admin only)
router.get(
  '/',
  verifyToken,
  requireAdmin,
  InvoiceController.listInvoices
);

module.exports = router;
