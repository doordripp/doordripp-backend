const Invoice = require('../models/Invoice');
const InvoiceItem = require('../models/InvoiceItem');
const Order = require('../models/Order');
const { calculateInvoiceGST, calculateRoundOff, getStateName } = require('../utils/gstCalculator');
const { generateInvoicePDF } = require('../utils/invoicePdfGenerator');
const path = require('path');
const fs = require('fs');

/**
 * Invoice Service
 * Handles all invoice generation business logic
 */

class InvoiceService {
  /**
   * Generate invoice for an order
   * @param {String} orderId - Order ID
   * @returns {Promise<Object>} - Generated invoice
   */
  static async generateInvoice(orderId) {
    try {
      // 1. Check if invoice already exists
      const existingInvoice = await Invoice.findOne({ orderId });
      if (existingInvoice) {
        throw new Error(`Invoice already exists for order ${orderId}: ${existingInvoice.invoiceNumber}`);
      }

      // 2. Fetch order details
      const order = await Order.findById(orderId).populate('customer').populate('items.product');
      if (!order) {
        throw new Error(`Order not found: ${orderId}`);
      }

      // 3. Validate order status
      // Invoice should be generated only for paid/delivered orders
      const allowedStatuses = ['delivered', 'shipped'];
      const paymentSuccess = ['paid', 'success'].includes(order.payment?.status);
      if (!paymentSuccess && !allowedStatuses.includes(order.status)) {
        throw new Error(`Cannot generate invoice for order with status: ${order.status}, payment: ${order.payment?.status}`);
      }

      // 4. Get seller details from config/env
      const sellerDetails = this.getSellerDetails();

      // 5. Get buyer details from order
      const buyerDetails = this.getBuyerDetails(order);

      // 6. Prepare items for GST calculation
      const items = order.items.map((item, index) => ({
        serialNumber: index + 1,
        productId: item.product?._id,
        productName: item.name || item.product?.name,
        productDescription: item.product?.description,
        hsnSac: item.product?.hsnSac || this.getDefaultHSN(item.product?.category),
        quantity: item.quantity,
        unit: 'PCS',
        unitPrice: item.price,
        discount: 0,
        taxableValue: item.price * item.quantity,
        gstRate: item.product?.gstRate || 0 // Default 0% if not specified
      }));

      // 7. Calculate GST
      const gstCalculation = calculateInvoiceGST(
        items,
        sellerDetails.stateCode,
        buyerDetails.stateCode
      );

      // 8. Calculate round-off
      const roundOffResult = calculateRoundOff(gstCalculation.summary.totalAmount);

      // 9. Generate invoice number
      const financialYear = Invoice.getFinancialYear();
      const invoiceNumber = await Invoice.generateNextInvoiceNumber(financialYear);

      // 10. Create invoice document
      const invoiceData = {
        invoiceNumber,
        invoiceDate: new Date(),
        financialYear,
        orderId: order._id,
        
        // Seller details
        sellerName: sellerDetails.name,
        sellerGSTIN: sellerDetails.gstin,
        sellerAddress: sellerDetails.address,
        sellerStateCode: sellerDetails.stateCode,
        // sellerPAN removed for privacy
        sellerEmail: sellerDetails.email,
        sellerPhone: sellerDetails.phone,
        
        // Buyer details
        buyerName: buyerDetails.name,
        buyerEmail: buyerDetails.email,
        buyerPhone: buyerDetails.phone,
        buyerAddress: buyerDetails.address,
        buyerGSTIN: buyerDetails.gstin,
        buyerStateCode: buyerDetails.stateCode,
        placeOfSupply: buyerDetails.placeOfSupply,
        
        // Financial details
        taxableAmount: gstCalculation.summary.totalTaxable,
        cgstAmount: gstCalculation.summary.totalCGST,
        sgstAmount: gstCalculation.summary.totalSGST,
        igstAmount: gstCalculation.summary.totalIGST,
        roundOffAmount: roundOffResult.roundOffAdjustment,
        totalAmount: roundOffResult.roundedAmount,
        
        // Payment details
        paymentMode: order.payment?.method || 'cod',
        paymentStatus: order.payment?.status === 'paid' ? 'paid' : 'cod',
        
        status: 'generated'
      };

      // 11. Save invoice to database
      const invoice = await Invoice.create(invoiceData);

      // 12. Save invoice items
      const invoiceItems = gstCalculation.items.map(item => ({
        invoiceId: invoice._id,
        productId: item.productId,
        productName: item.productName,
        productDescription: item.productDescription,
        hsnSac: item.hsnSac,
        quantity: item.quantity,
        unit: item.unit,
        unitPrice: item.unitPrice,
        discount: item.discount || 0,
        taxableValue: item.taxableValue,
        gstRate: item.gstRate,
        cgst: item.cgst,
        cgstRate: item.cgstRate,
        sgst: item.sgst,
        sgstRate: item.sgstRate,
        igst: item.igst,
        igstRate: item.igstRate,
        totalPrice: item.totalAmount, // Map totalAmount from GST calc to totalPrice
        serialNumber: item.serialNumber
      }));

      await InvoiceItem.insertMany(invoiceItems);

      // 13. Generate PDF
      const pdfPath = await this.generateInvoicePDF(invoice, invoiceItems);

      // 14. Update invoice with PDF path
      invoice.invoicePdfPath = pdfPath;
      invoice.invoicePdfUrl = this.getPDFUrl(pdfPath);
      await invoice.save();

      // 15. Return invoice
      return {
        invoice,
        items: invoiceItems,
        pdfUrl: invoice.invoicePdfUrl,
        pdfPath: invoice.invoicePdfPath
      };

    } catch (error) {
      console.error('Error generating invoice:', error);
      throw error;
    }
  }

  /**
   * Get seller details (DoorDripp)
   * Should be fetched from environment variables or config
   */
  static getSellerDetails() {
    return {
      name: process.env.COMPANY_NAME || 'DoorDripp',
      gstin: process.env.COMPANY_GSTIN || '27XXXXXXXXXXXXX',
      pan: process.env.COMPANY_PAN || 'XXXXX0000X',
      stateCode: process.env.COMPANY_STATE_CODE || '27', // Maharashtra
      email: process.env.COMPANY_EMAIL || 'support@doordripp.com',
      phone: process.env.COMPANY_PHONE || '+91-XXXXXXXXXX',
      address: {
        line1: process.env.COMPANY_ADDRESS_LINE1 || 'Office Address Line 1',
        line2: process.env.COMPANY_ADDRESS_LINE2 || 'Office Address Line 2',
        city: process.env.COMPANY_CITY || 'Mumbai',
        state: process.env.COMPANY_STATE || 'Maharashtra',
        pincode: process.env.COMPANY_PINCODE || '400001',
        country: 'India'
      }
    };
  }

  /**
   * Get buyer details from order
   */
  static getBuyerDetails(order) {
    const shippingAddress = order.shippingAddress || {};
    const customer = order.customer || {};
    
    // Extract state code from pincode or use default
    const stateCode = this.getStateCodeFromPincode(shippingAddress.pincode) || '27';
    
    return {
      name: customer.name || 'Customer',
      email: customer.email || shippingAddress.email || '',
      phone: customer.phone || shippingAddress.phone || '',
      gstin: customer.gstin || '', // Optional for B2C
      stateCode,
      placeOfSupply: getStateName(stateCode),
      address: {
        line1: shippingAddress.addressLine1 || shippingAddress.line1 || '',
        line2: shippingAddress.addressLine2 || shippingAddress.line2 || '',
        city: shippingAddress.city || '',
        state: shippingAddress.state || '',
        pincode: shippingAddress.pincode || shippingAddress.zipCode || '',
        country: shippingAddress.country || 'India'
      }
    };
  }

  /**
   * Get default HSN/SAC code based on product category
   */
  static getDefaultHSN(category) {
    const hsnMapping = {
      'clothing': '6109',
      'electronics': '8517',
      'books': '4901',
      'food': '2106',
      'furniture': '9403',
      'toys': '9503'
    };
    
    return hsnMapping[category?.toLowerCase()] || '9973'; // 9973 = Other services
  }

  /**
   * Get state code from pincode (simplified mapping)
   * In production, use a proper pincode-to-state database
   */
  static getStateCodeFromPincode(pincode) {
    if (!pincode) return null;
    
    const pincodeStr = String(pincode);
    const firstDigit = pincodeStr[0];
    
    // Simplified mapping based on first digit
    const stateMapping = {
      '1': '07', // Delhi
      '2': '27', // Maharashtra
      '3': '33', // Tamil Nadu
      '4': '29', // Karnataka
      '5': '36', // Telangana
      '6': '32', // Kerala
      '7': '23', // Madhya Pradesh
      '8': '19', // West Bengal
      '9': '09'  // Uttar Pradesh
    };
    
    return stateMapping[firstDigit] || '27'; // Default to Maharashtra
  }

  /**
   * Generate PDF for invoice
   */
  static async generateInvoicePDF(invoice, items) {
    try {
      // Prepare data for PDF
      const pdfData = {
        ...(invoice.toObject ? invoice.toObject() : invoice),
        items: items.map(item => item.toObject ? item.toObject() : item)
      };

      // Define output path
      const invoicesDir = path.join(__dirname, '../../invoices');
      if (!fs.existsSync(invoicesDir)) {
        fs.mkdirSync(invoicesDir, { recursive: true });
      }

      const filename = `${invoice.invoiceNumber.replace(/\//g, '-')}.pdf`;
      const outputPath = path.join(invoicesDir, filename);

      // Generate PDF
      await generateInvoicePDF(pdfData, outputPath);

      return outputPath;
    } catch (error) {
      console.error('Error generating PDF:', error);
      throw new Error(`Failed to generate PDF: ${error.message}`);
    }
  }

  /**
   * Get public URL for PDF
   * In production, upload to S3/Cloud Storage and return public URL
   */
  static getPDFUrl(pdfPath) {
    // For now, return a relative path
    // In production, upload to cloud storage and return public URL
    const filename = path.basename(pdfPath);
    return `/invoices/${filename}`;
  }

  /**
   * Get invoice by ID
   */
  static async getInvoiceById(invoiceId) {
    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) {
      throw new Error(`Invoice not found: ${invoiceId}`);
    }

    const items = await InvoiceItem.find({ invoiceId: invoice._id });

    return {
      invoice,
      items
    };
  }

  /**
   * Get invoice by invoice number
   */
  static async getInvoiceByNumber(invoiceNumber) {
    const invoice = await Invoice.findOne({ invoiceNumber });
    if (!invoice) {
      throw new Error(`Invoice not found: ${invoiceNumber}`);
    }

    const items = await InvoiceItem.find({ invoiceId: invoice._id });

    return {
      invoice,
      items
    };
  }

  /**
   * Get invoice by order ID
   */
  static async getInvoiceByOrderId(orderId) {
    const invoice = await Invoice.findOne({ orderId });
    if (!invoice) {
      return null;
    }

    const items = await InvoiceItem.find({ invoiceId: invoice._id });

    return {
      invoice,
      items
    };
  }

  /**
   * List invoices with filters
   */
  static async listInvoices(filters = {}, page = 1, limit = 50) {
    const skip = (page - 1) * limit;

    const query = {};
    if (filters.financialYear) query.financialYear = filters.financialYear;
    if (filters.status) query.status = filters.status;
    if (filters.startDate && filters.endDate) {
      query.invoiceDate = {
        $gte: new Date(filters.startDate),
        $lte: new Date(filters.endDate)
      };
    }

    const [invoices, total] = await Promise.all([
      Invoice.find(query)
        .sort({ invoiceDate: -1 })
        .skip(skip)
        .limit(limit)
        .populate('orderId'),
      Invoice.countDocuments(query)
    ]);

    return {
      invoices,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    };
  }
}

module.exports = InvoiceService;
