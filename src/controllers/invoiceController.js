const InvoiceService = require('../services/invoiceService');
const logger = require('../utils/logger');
const Invoice = require('../models/Invoice');
const Order = require('../models/Order');
const mongoose = require('mongoose');
const { hasAnyRole, authenticateRequest } = require('../middleware/auth');
const { signPurposeToken, verifyPurposeToken } = require('../config/auth');

const INVOICE_DOWNLOAD_PURPOSE = 'invoice-download';
const INVOICE_LINK_TTL = '15m';

const isStaff = (user) => Boolean(user && hasAnyRole(user.roles, ['admin', 'manager']));

/** An invoice may be read by staff or by the customer who placed its order. */
async function canAccessInvoice(user, invoice) {
  if (!user || !invoice) return false;
  if (isStaff(user)) return true;
  const order = await Order.findById(invoice.orderId).select('customer').lean();
  return Boolean(order && String(order.customer) === String(user.id));
}

const notFound = (res) => res.status(404).json({ success: false, message: 'Invoice not found' });

const publicBaseUrl = (req) => {
  const configured = String(process.env.BACKEND_URL || '').trim().replace(/\/+$/, '');
  return configured || `${req.protocol}://${req.get('host')}`;
};

/**
 * Invoice Controller
 * Handles HTTP requests for invoice operations
 */

class InvoiceController {
  /**
   * Generate invoice for an order
   * POST /api/invoices/generate/:orderId
   */
  static async generateInvoice(req, res, next) {
    try {
      const { orderId } = req.params;

      // Check if invoice already exists
      const existing = await InvoiceService.getInvoiceByOrderId(orderId);
      if (existing) {
        return res.status(400).json({
          success: false,
          message: 'Invoice already exists for this order',
          invoice: existing.invoice,
          pdfUrl: existing.invoice.invoicePdfUrl
        });
      }

      // Generate invoice
      const result = await InvoiceService.generateInvoice(orderId);

      res.status(201).json({
        success: true,
        message: 'Invoice generated successfully',
        invoiceNumber: result.invoice.invoiceNumber,
        invoiceId: result.invoice._id,
        pdfUrl: result.pdfUrl,
        invoice: result.invoice
      });
    } catch (error) {
      logger.error('Error in generateInvoice:', error);
      next(error);
    }
  }

  /**
   * Get invoice by ID
   * GET /api/invoices/:invoiceId
   */
  static async getInvoice(req, res, next) {
    try {
      const { invoiceId } = req.params;

      if (!mongoose.Types.ObjectId.isValid(String(invoiceId))) return notFound(res);
      const result = await InvoiceService.getInvoiceById(invoiceId);
      if (!(await canAccessInvoice(req.user, result.invoice))) return notFound(res);

      res.json({
        success: true,
        invoice: result.invoice,
        items: result.items
      });
    } catch (error) {
      if (error.message.includes('not found')) {
        return res.status(404).json({
          success: false,
          message: error.message
        });
      }
      next(error);
    }
  }

  /**
   * Get invoice by invoice number
   * GET /api/invoices/number/:invoiceNumber
   */
  static async getInvoiceByNumber(req, res, next) {
    try {
      const { invoiceNumber } = req.params;

      const result = await InvoiceService.getInvoiceByNumber(String(invoiceNumber));
      if (!(await canAccessInvoice(req.user, result.invoice))) return notFound(res);

      res.json({
        success: true,
        invoice: result.invoice,
        items: result.items
      });
    } catch (error) {
      if (error.message.includes('not found')) {
        return res.status(404).json({
          success: false,
          message: error.message
        });
      }
      next(error);
    }
  }

  /**
   * Get invoice by order ID
   * GET /api/invoices/order/:orderId
   */
  static async getInvoiceByOrder(req, res, next) {
    try {
      const { orderId } = req.params;

      if (!mongoose.Types.ObjectId.isValid(String(orderId))) return notFound(res);
      const result = await InvoiceService.getInvoiceByOrderId(orderId);

      if (!result || !(await canAccessInvoice(req.user, result.invoice))) {
        return res.status(404).json({
          success: false,
          message: 'Invoice not found for this order'
        });
      }

      res.json({
        success: true,
        invoice: result.invoice,
        items: result.items
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * List invoices with filters
   * GET /api/invoices
   */
  static async listInvoices(req, res, next) {
    try {
      const { financialYear, status, startDate, endDate, page = 1, limit = 50 } = req.query;

      const filters = {};
      if (financialYear) filters.financialYear = financialYear;
      if (status) filters.status = status;
      if (startDate && endDate) {
        filters.startDate = startDate;
        filters.endDate = endDate;
      }

      const result = await InvoiceService.listInvoices(filters, parseInt(page), parseInt(limit));

      res.json({
        success: true,
        invoices: result.invoices,
        pagination: {
          total: result.total,
          page: result.page,
          totalPages: result.totalPages,
          limit: parseInt(limit)
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Download invoice PDF
   * GET /api/invoices/:invoiceId/download
   */
  static async downloadInvoice(req, res, next) {
    try {
      const { invoiceId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(String(invoiceId))) return notFound(res);

      // Either a short-lived link issued by GET /api/orders/:id/invoice (so the
      // PDF can open in a browser, which has no Authorization header) ...
      let authorised = false;
      const linkToken = typeof req.query.token === 'string' ? req.query.token : null;
      if (linkToken) {
        try {
          const payload = verifyPurposeToken(linkToken, INVOICE_DOWNLOAD_PURPOSE);
          authorised = String(payload.invoiceId) === String(invoiceId);
        } catch (err) {
          authorised = false;
        }
        if (!authorised) return res.status(401).json({ success: false, message: 'Download link is invalid or has expired' });
      }

      let result;
      try {
        result = await InvoiceService.getInvoiceById(invoiceId);
      } catch (err) {
        result = null;
      }

      // ... or a signed-in user who owns the order (or is staff).
      if (!authorised) {
        let user;
        try {
          ({ user } = await authenticateRequest(req));
        } catch (err) {
          return res.status(401).json({ error: 'No token provided' });
        }
        if (!result || !(await canAccessInvoice({ id: user._id, roles: user.roles }, result.invoice))) return notFound(res);
      }
      if (!result) return notFound(res);

      const invoice = result.invoice;
      const fs = require('fs');

      if (!invoice.invoicePdfPath || !fs.existsSync(invoice.invoicePdfPath)) {
        // Container file systems are ephemeral: rebuild the PDF from the stored invoice.
        try {
          const pdfPath = await InvoiceService.generateInvoicePDF(invoice, result.items);
          invoice.invoicePdfPath = pdfPath;
          invoice.invoicePdfUrl = InvoiceService.getPDFUrl(pdfPath);
          await invoice.save();
        } catch (err) {
          logger.error('Could not rebuild invoice PDF', err);
          return res.status(404).json({ success: false, message: 'PDF file not found on server' });
        }
      }

      res.setHeader('Cache-Control', 'private, no-store');
      res.download(invoice.invoicePdfPath, `Invoice-${invoice.invoiceNumber.replace(/\//g, '-')}.pdf`);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Invoice link for one of the caller's own orders (used by the mobile app).
   * GET /api/orders/:id/invoice
   * -> { success, orderId, invoiceNumber, downloadUrl, invoiceUrl, pdfUrl }
   */
  static async getOrderInvoiceLink(req, res, next) {
    try {
      const orderId = req.params.id;
      if (!mongoose.Types.ObjectId.isValid(String(orderId))) {
        return res.status(404).json({ success: false, error: 'Order not found' });
      }

      const order = await Order.findById(orderId).select('customer status payment').lean();
      const isOwner = order && String(order.customer) === String(req.user.id);
      // Same answer for "does not exist" and "not yours".
      if (!order || (!isOwner && !isStaff(req.user))) {
        return res.status(404).json({ success: false, error: 'Order not found' });
      }

      let result = await InvoiceService.getInvoiceByOrderId(orderId);
      if (!result) {
        try {
          await InvoiceService.generateInvoice(String(orderId));
          result = await InvoiceService.getInvoiceByOrderId(orderId);
        } catch (err) {
          // Raced with another generator, or the order is not invoiceable yet.
          result = await InvoiceService.getInvoiceByOrderId(orderId);
        }
      }
      if (!result) {
        return res.status(404).json({ success: false, error: 'Invoice is not available for this order yet' });
      }

      const linkToken = signPurposeToken(
        { invoiceId: String(result.invoice._id) },
        INVOICE_DOWNLOAD_PURPOSE,
        INVOICE_LINK_TTL
      );
      const downloadUrl = `${publicBaseUrl(req)}/api/invoices/${result.invoice._id}/download?token=${encodeURIComponent(linkToken)}`;

      return res.json({
        success: true,
        orderId: String(orderId),
        invoiceNumber: result.invoice.invoiceNumber,
        downloadUrl,
        invoiceUrl: downloadUrl,
        pdfUrl: downloadUrl
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get current financial year
   * GET /api/invoices/financial-year/current
   */
  static async getCurrentFinancialYear(req, res) {
    try {
      const fy = Invoice.getFinancialYear();
      res.json({
        success: true,
        financialYear: fy
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }
}

module.exports = InvoiceController;
