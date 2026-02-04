const InvoiceService = require('../services/invoiceService');
const Invoice = require('../models/Invoice');

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
      console.error('Error in generateInvoice:', error);
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

      const result = await InvoiceService.getInvoiceById(invoiceId);

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

      const result = await InvoiceService.getInvoiceByNumber(invoiceNumber);

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

      const result = await InvoiceService.getInvoiceByOrderId(orderId);

      if (!result) {
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

      const result = await InvoiceService.getInvoiceById(invoiceId);
      const invoice = result.invoice;

      if (!invoice.invoicePdfPath) {
        return res.status(404).json({
          success: false,
          message: 'PDF not found for this invoice'
        });
      }

      const fs = require('fs');
      if (!fs.existsSync(invoice.invoicePdfPath)) {
        return res.status(404).json({
          success: false,
          message: 'PDF file not found on server'
        });
      }

      // Send PDF file
      res.download(invoice.invoicePdfPath, `Invoice-${invoice.invoiceNumber.replace(/\//g, '-')}.pdf`);
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
