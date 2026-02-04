const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

/**
 * Generate GST-compliant Tax Invoice PDF
 * @param {Object} invoiceData - Invoice data with all details
 * @param {String} outputPath - File path to save PDF
 * @returns {Promise<String>} - Path to generated PDF
 */
async function generateInvoicePDF(invoiceData, outputPath) {
  return new Promise((resolve, reject) => {
    try {
      // Create PDF document
      const doc = new PDFDocument({
        size: 'A4',
        margin: 40,
        info: {
          Title: `Invoice ${invoiceData.invoiceNumber}`,
          Author: 'DoorDripp'
        }
      });

      // Ensure directory exists
      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Pipe to file
      const stream = fs.createWriteStream(outputPath);
      doc.pipe(stream);

      // Build PDF content
      addHeader(doc, invoiceData);
      addSellerBuyerDetails(doc, invoiceData);
      addItemsTable(doc, invoiceData);
      addTotals(doc, invoiceData);
      addDeclaration(doc, invoiceData);
      addFooter(doc, invoiceData);

      // Finalize PDF
      doc.end();

      stream.on('finish', () => {
        resolve(outputPath);
      });

      stream.on('error', (err) => {
        reject(err);
      });

    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Add header with invoice title and company details
 */
function addHeader(doc, data) {
  const pageWidth = doc.page.width;
  
  // Title
  doc.fontSize(20)
    .font('Helvetica-Bold')
    .text('TAX INVOICE', { align: 'center' });
  
  doc.moveDown(0.5);
  
  // Company name
  doc.fontSize(16)
    .text(data.sellerName || 'DoorDripp', { align: 'center' });
  
  doc.fontSize(9)
    .font('Helvetica')
    .text(`GSTIN: ${data.sellerGSTIN}`, { align: 'center' });
  
  if (data.sellerPAN) {
    doc.text(`PAN: ${data.sellerPAN}`, { align: 'center' });
  }
  
  doc.moveDown(1);
  
  // Horizontal line
  doc.moveTo(40, doc.y)
    .lineTo(pageWidth - 40, doc.y)
    .stroke();
  
  doc.moveDown(0.5);
}

/**
 * Add seller and buyer details in two columns
 */
function addSellerBuyerDetails(doc, data) {
  const startY = doc.y;
  const pageWidth = doc.page.width;
  const midX = pageWidth / 2;
  
  // Invoice details
  doc.fontSize(10)
    .font('Helvetica-Bold')
    .text(`Invoice No: `, 40, startY)
    .font('Helvetica')
    .text(data.invoiceNumber, 120, startY);
  
  doc.font('Helvetica-Bold')
    .text(`Invoice Date: `, 40, doc.y)
    .font('Helvetica')
    .text(formatDate(data.invoiceDate), 120, doc.y);
  
  if (data.orderId) {
    doc.font('Helvetica-Bold')
      .text(`Order ID: `, 40, doc.y)
      .font('Helvetica')
      .text(data.orderId, 120, doc.y);
  }
  
  doc.moveDown(1);
  
  const detailsStartY = doc.y;
  
  // Left column - Seller (Billed From)
  doc.fontSize(10)
    .font('Helvetica-Bold')
    .text('Billed From:', 40, detailsStartY);
  
  doc.fontSize(9)
    .font('Helvetica')
    .text(data.sellerName || 'DoorDripp', 40, doc.y);
  
  if (data.sellerAddress) {
    const addr = data.sellerAddress;
    const addressLines = [
      addr.line1,
      addr.line2,
      `${addr.city}, ${addr.state} - ${addr.pincode}`,
      addr.country || 'India'
    ].filter(Boolean);
    
    addressLines.forEach(line => {
      doc.text(line, 40, doc.y);
    });
  }
  
  doc.text(`GSTIN: ${data.sellerGSTIN}`, 40, doc.y);
  doc.text(`State Code: ${data.sellerStateCode}`, 40, doc.y);
  
  if (data.sellerPhone) {
    doc.text(`Phone: ${data.sellerPhone}`, 40, doc.y);
  }
  if (data.sellerEmail) {
    doc.text(`Email: ${data.sellerEmail}`, 40, doc.y);
  }
  
  // Right column - Buyer (Billed To)
  const rightX = midX + 20;
  doc.fontSize(10)
    .font('Helvetica-Bold')
    .text('Billed To:', rightX, detailsStartY);
  
  doc.fontSize(9)
    .font('Helvetica')
    .text(data.buyerName, rightX, doc.y);
  
  if (data.buyerAddress) {
    const addr = data.buyerAddress;
    const addressLines = [
      addr.line1,
      addr.line2,
      `${addr.city}, ${addr.state} - ${addr.pincode}`,
      addr.country || 'India'
    ].filter(Boolean);
    
    addressLines.forEach(line => {
      doc.text(line, rightX, doc.y);
    });
  }
  
  if (data.buyerGSTIN) {
    doc.text(`GSTIN: ${data.buyerGSTIN}`, rightX, doc.y);
  }
  
  doc.text(`State Code: ${data.buyerStateCode}`, rightX, doc.y);
  doc.text(`Place of Supply: ${data.placeOfSupply}`, rightX, doc.y);
  
  if (data.buyerPhone) {
    doc.text(`Phone: ${data.buyerPhone}`, rightX, doc.y);
  }
  if (data.buyerEmail) {
    doc.text(`Email: ${data.buyerEmail}`, rightX, doc.y);
  }
  
  doc.moveDown(2);
}

/**
 * Add items table
 */
function addItemsTable(doc, data) {
  const items = data.items || [];
  const tableTop = doc.y;
  const pageWidth = doc.page.width;
  
  // Table header
  doc.fontSize(9).font('Helvetica-Bold');
  
  const colX = {
    sno: 40,
    description: 70,
    hsn: 240,
    qty: 290,
    rate: 330,
    taxable: 380,
    gst: 440,
    amount: 500
  };
  
  // Header background
  doc.rect(40, tableTop, pageWidth - 80, 20)
    .fillAndStroke('#f0f0f0', '#000');
  
  doc.fillColor('#000')
    .text('S.No', colX.sno, tableTop + 5, { width: 25 })
    .text('Description', colX.description, tableTop + 5, { width: 160 })
    .text('HSN', colX.hsn, tableTop + 5, { width: 40 })
    .text('Qty', colX.qty, tableTop + 5, { width: 30 })
    .text('Rate', colX.rate, tableTop + 5, { width: 40 })
    .text('Taxable', colX.taxable, tableTop + 5, { width: 50 })
    .text('GST', colX.gst, tableTop + 5, { width: 50 })
    .text('Amount', colX.amount, tableTop + 5, { width: 60 });
  
  let currentY = tableTop + 25;
  
  // Items
  doc.font('Helvetica').fontSize(8);
  
  items.forEach((item, index) => {
    // Check if we need a new page
    if (currentY > 700) {
      doc.addPage();
      currentY = 50;
    }
    
    const rowHeight = 20;
    
    // Alternate row background
    if (index % 2 === 0) {
      doc.rect(40, currentY, pageWidth - 80, rowHeight)
        .fillAndStroke('#f9f9f9', '#ddd');
    } else {
      doc.rect(40, currentY, pageWidth - 80, rowHeight)
        .stroke('#ddd');
    }
    
    doc.fillColor('#000')
      .text(item.serialNumber || (index + 1), colX.sno, currentY + 5, { width: 25 })
      .text(item.productName, colX.description, currentY + 5, { width: 160, height: rowHeight - 5 })
      .text(item.hsnSac || '-', colX.hsn, currentY + 5, { width: 40 })
      .text(item.quantity, colX.qty, currentY + 5, { width: 30 })
      .text(`₹${item.unitPrice.toFixed(2)}`, colX.rate, currentY + 5, { width: 40 })
      .text(`₹${item.taxableValue.toFixed(2)}`, colX.taxable, currentY + 5, { width: 50 })
      .text(`${item.gstRate}%`, colX.gst, currentY + 5, { width: 50 })
      .text(`₹${item.totalPrice.toFixed(2)}`, colX.amount, currentY + 5, { width: 60 });
    
    currentY += rowHeight;
  });
  
  // Bottom border
  doc.moveTo(40, currentY)
    .lineTo(pageWidth - 40, currentY)
    .stroke();
  
  doc.y = currentY + 10;
}

/**
 * Add totals section
 */
function addTotals(doc, data) {
  const pageWidth = doc.page.width;
  const rightX = pageWidth - 200;
  
  doc.fontSize(9).font('Helvetica');
  
  const startY = doc.y;
  
  // Taxable Amount
  doc.text('Taxable Amount:', rightX, startY, { width: 100 });
  doc.text(`₹${data.taxableAmount.toFixed(2)}`, rightX + 100, startY, { width: 80, align: 'right' });
  
  // CGST / SGST / IGST
  if (data.cgstAmount > 0) {
    doc.text('CGST:', rightX, doc.y, { width: 100 });
    doc.text(`₹${data.cgstAmount.toFixed(2)}`, rightX + 100, doc.y, { width: 80, align: 'right' });
    
    doc.text('SGST:', rightX, doc.y, { width: 100 });
    doc.text(`₹${data.sgstAmount.toFixed(2)}`, rightX + 100, doc.y, { width: 80, align: 'right' });
  }
  
  if (data.igstAmount > 0) {
    doc.text('IGST:', rightX, doc.y, { width: 100 });
    doc.text(`₹${data.igstAmount.toFixed(2)}`, rightX + 100, doc.y, { width: 80, align: 'right' });
  }
  
  // Round off
  if (data.roundOffAmount && Math.abs(data.roundOffAmount) > 0) {
    doc.text('Round Off:', rightX, doc.y, { width: 100 });
    doc.text(`₹${data.roundOffAmount.toFixed(2)}`, rightX + 100, doc.y, { width: 80, align: 'right' });
  }
  
  // Total line
  doc.moveTo(rightX, doc.y + 5)
    .lineTo(pageWidth - 40, doc.y + 5)
    .stroke();
  
  doc.moveDown(0.3);
  
  // Total Amount
  doc.fontSize(11).font('Helvetica-Bold');
  doc.text('Total Amount:', rightX, doc.y, { width: 100 });
  doc.text(`₹${data.totalAmount.toFixed(2)}`, rightX + 100, doc.y, { width: 80, align: 'right' });
  
  doc.moveDown(1);
  
  // Amount in words
  doc.fontSize(9).font('Helvetica-Bold');
  doc.text(`Amount in Words: ${numberToWords(data.totalAmount)} Rupees Only`, 40, doc.y);
  
  doc.moveDown(1);
}

/**
 * Add declaration and terms
 */
function addDeclaration(doc, data) {
  doc.fontSize(8).font('Helvetica-Oblique');
  
  const declaration = data.termsAndConditions || 
    'This is a computer-generated invoice and does not require a physical signature.';
  
  doc.text('Declaration:', 40, doc.y);
  doc.font('Helvetica').text(declaration, 40, doc.y, { width: doc.page.width - 80 });
  
  doc.moveDown(1);
}

/**
 * Add footer
 */
function addFooter(doc, data) {
  const pageHeight = doc.page.height;
  const footerY = pageHeight - 80;
  
  doc.fontSize(8).font('Helvetica');
  
  // Signature area
  doc.text('For ' + (data.sellerName || 'DoorDripp'), doc.page.width - 200, footerY);
  doc.text('Authorized Signatory', doc.page.width - 200, footerY + 30);
  
  // Footer text
  doc.fontSize(7);
  doc.text('Thank you for your business!', 40, pageHeight - 40, { align: 'center' });
}

/**
 * Format date to DD/MM/YYYY
 */
function formatDate(date) {
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Convert number to words (simplified - for Indian currency)
 */
function numberToWords(num) {
  if (num === 0) return 'Zero';
  
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  
  const wholePart = Math.floor(num);
  
  if (wholePart < 10) return ones[wholePart];
  if (wholePart < 20) return teens[wholePart - 10];
  if (wholePart < 100) {
    return tens[Math.floor(wholePart / 10)] + (wholePart % 10 ? ' ' + ones[wholePart % 10] : '');
  }
  if (wholePart < 1000) {
    return ones[Math.floor(wholePart / 100)] + ' Hundred' + (wholePart % 100 ? ' ' + numberToWords(wholePart % 100) : '');
  }
  if (wholePart < 100000) {
    return numberToWords(Math.floor(wholePart / 1000)) + ' Thousand' + (wholePart % 1000 ? ' ' + numberToWords(wholePart % 1000) : '');
  }
  if (wholePart < 10000000) {
    return numberToWords(Math.floor(wholePart / 100000)) + ' Lakh' + (wholePart % 100000 ? ' ' + numberToWords(wholePart % 100000) : '');
  }
  
  return 'Amount Too Large';
}

module.exports = {
  generateInvoicePDF
};
