const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

// Load logo
const LOGO_PATH = path.join(__dirname, '../templates/logo_base64.txt');
let LOGO_BASE64 = null;
try {
  LOGO_BASE64 = fs.readFileSync(LOGO_PATH, 'utf8').trim();
} catch (e) { /* no logo available */ }

/**
 * Generate single-page Invoice PDF matching the DoorDripp screenshot.
 * TAX column removed. Prices from unitPrice/totalPrice fields.
 */
async function generateInvoicePDF(invoiceData, outputPath) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 40,
        info: { Title: `Invoice ${invoiceData.invoiceNumber || ''}`, Author: 'DoorDripp' }
      });

      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const stream = fs.createWriteStream(outputPath);
      doc.pipe(stream);

      renderInvoice(doc, invoiceData);

      doc.end();
      stream.on('finish', () => resolve(outputPath));
      stream.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtDate(date) {
  if (!date) return '-';
  const d = new Date(date);
  if (isNaN(d.getTime())) return String(date);
  return d.toLocaleDateString('en-IN');
}

function fmtCurrency(value) {
  const n = Number(value || 0);
  return '\u20b9' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Main render ─────────────────────────────────────────────────────────────

function renderInvoice(doc, data) {
  const L = 40;           // left margin
  const W = doc.page.width - L * 2;   // usable width

  drawHeader(doc, data, L, W);
  drawTitle(doc, L, W);
  drawMetaAndAddresses(doc, data, L, W);
  drawTable(doc, data, L, W);
  drawFooter(doc, L, W);
}

// ─── Header (logo + company, top-right) ──────────────────────────────────────

function drawHeader(doc, data, L, W) {
  const top = doc.y;
  const R = L + W;
  const logoSize = 44;

  const phone = data.sellerPhone || '9286819663';
  const email = data.sellerEmail || 'doordripp@gmail.com';
  const company = data.sellerName || 'Doordripp pvt. ltd.';
  const contactLine = `Contact Us : ${phone} || ${email}`;

  // Right-align text block
  doc.font('Helvetica').fontSize(7.5);
  const cW = doc.widthOfString(contactLine);
  doc.font('Helvetica-Bold').fontSize(10);
  const nW = doc.widthOfString(company);
  const blockW = Math.max(cW, nW) + 4;

  const gap = 6;
  const totalGroupW = logoSize + gap + blockW;
  const startX = R - totalGroupW;

  // Draw logo
  if (LOGO_BASE64) {
    try {
      const buf = Buffer.from(LOGO_BASE64, 'base64');
      doc.image(buf, startX, top, { width: logoSize, height: logoSize, fit: [logoSize, logoSize] });
    } catch (e) {
      drawLogoPlaceholder(doc, startX, top, logoSize);
    }
  } else {
    drawLogoPlaceholder(doc, startX, top, logoSize);
  }

  const tx = startX + logoSize + gap;

  doc.fillColor('#333').font('Helvetica').fontSize(7.5);
  doc.text(contactLine, tx, top + 2, { width: blockW, lineBreak: false });

  doc.fillColor('#000').font('Helvetica-Bold').fontSize(10);
  doc.text(company, tx, top + 13, { width: blockW, lineBreak: false });

  doc.fillColor('#c98a00').font('Helvetica').fontSize(7.5);
  doc.text('Drive up your taste & Stay', tx, top + 26, { width: blockW, lineBreak: false });

  doc.y = top + logoSize + 6;
}

function drawLogoPlaceholder(doc, x, y, size) {
  doc.save().rect(x, y, size, size).fill('#eee').restore();
  doc.fillColor('#555').font('Helvetica-Bold').fontSize(12);
  doc.text('DD', x, y + size / 2 - 7, { width: size, align: 'center', lineBreak: false });
}

// ─── INVOICE title ───────────────────────────────────────────────────────────

function drawTitle(doc, L, W) {
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(18);
  const titleY = doc.y + 4;
  doc.text('INVOICE', L, titleY, { width: W, align: 'center', lineBreak: false });

  const tw = doc.widthOfString('INVOICE');
  const tx = L + (W - tw) / 2;
  const ty = titleY + 20;
  doc.moveTo(tx, ty).lineTo(tx + tw, ty).strokeColor('#000').lineWidth(1).stroke();

  doc.y = ty + 8;
}

// ─── Meta + Addresses ────────────────────────────────────────────────────────

function drawMetaAndAddresses(doc, data, L, W) {
  const top = doc.y;
  const colH = 76;
  const c1W = 160, c2W = 190, c3W = W - c1W - c2W;
  const c2X = L + c1W, c3X = L + c1W + c2W;

  // outer border
  doc.save().strokeColor('#888').lineWidth(0.5).rect(L, top, W, colH).stroke().restore();

  // vertical dividers
  doc.save().strokeColor('#888').lineWidth(0.5);
  doc.moveTo(c2X, top).lineTo(c2X, top + colH).stroke();
  doc.moveTo(c3X, top).lineTo(c3X, top + colH).stroke();
  doc.restore();

  // ── Left: order meta ──
  const fields = [
    ['ORDER ID:', data.orderId || ''],
    ['ORDER DATE:', fmtDate(data.invoiceDate)],
    ['Invoice No.:', data.invoiceNumber || ''],
    ['Invoice Date :', fmtDate(data.invoiceDate)],
    ['VAT/TIN :', data.vatTin || ''],
  ];
  let y = top + 6;
  fields.forEach(([lbl, val]) => {
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(8).text(lbl, L + 4, y, { lineBreak: false });
    const lw = doc.widthOfString(lbl);
    doc.fillColor('#222').font('Helvetica').fontSize(8).text(' ' + val, L + 4 + lw, y, { lineBreak: false });
    y += 12;
  });

  // ── Middle: Shipping ──
  let sy = top + 6;
  doc.fillColor('#c98a00').font('Helvetica-Bold').fontSize(8).text('SHIPPING ADDRESS :', c2X + 6, sy, { lineBreak: false });
  sy += 12;
  doc.fillColor('#1a3dad').font('Helvetica-Bold').fontSize(11);
  doc.text(data.buyerName || data.customerName || 'Customer', c2X + 6, sy, { width: c2W - 12, lineBreak: false });
  sy += 14;
  doc.fillColor('#555').font('Helvetica').fontSize(9);
  doc.text('\uD83D\uDCDE  ' + (data.buyerPhone || ''), c2X + 6, sy, { width: c2W - 12, lineBreak: false });
  sy += 12;
  doc.text('\u2709  ' + (data.buyerEmail || ''), c2X + 6, sy, { width: c2W - 12, lineBreak: false });

  // ── Right: Billing ──
  let by = top + 6;
  doc.fillColor('#c98a00').font('Helvetica-Bold').fontSize(8).text('BILLING ADDRESS :', c3X + 6, by, { lineBreak: false });
  by += 12;
  doc.fillColor('#1a3dad').font('Helvetica-Bold').fontSize(11).text('DoorDripp office', c3X + 6, by, { width: c3W - 12, lineBreak: false });

  doc.y = top + colH + 8;
}

// ─── Items Table (no TAX column) ─────────────────────────────────────────────

function drawTable(doc, data, L, W) {
  const rowH = 22;
  const grandH = 26;

  // Columns: SR NO | PRODUCT | QTY | PRICE | TOTAL
  const cols = [
    { key: 'sno',     label: 'SR NO.',  w: 44,  align: 'center' },
    { key: 'product', label: 'PRODUCT', w: null, align: 'left'   },  // w=null → fills rest
    { key: 'qty',     label: 'QTY',     w: 48,  align: 'center' },
    { key: 'price',   label: 'PRICE',   w: 84,  align: 'right'  },
    { key: 'total',   label: 'TOTAL',   w: 92,  align: 'right'  },
  ];

  // resolve "product" column width
  const fixedW = cols.reduce((s, c) => s + (c.w || 0), 0);
  cols.find(c => c.key === 'product').w = W - fixedW;

  // Compute x positions
  let cx = L;
  const colMap = {};
  cols.forEach(c => { colMap[c.key] = cx; cx += c.w; });

  // Border helpers
  const border = (x, y, w, h) => {
    doc.save().strokeColor('#000').lineWidth(0.75).rect(x, y, w, h).stroke().restore();
  };
  const vlines = (y, h) => {
    doc.save().strokeColor('#000').lineWidth(0.75);
    let px = L;
    cols.forEach(c => { doc.moveTo(px, y).lineTo(px, y + h).stroke(); px += c.w; });
    doc.moveTo(px, y).lineTo(px, y + h).stroke();
    doc.restore();
  };

  const cell = (text, x, y, w, h, align = 'center', bold = false, sz = 9) => {
    doc.fillColor('#000').font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(sz);
    const pad = 3;
    doc.text(String(text), x + pad, y + (h - sz) / 2, {
      width: w - pad * 2,
      align,
      lineBreak: false
    });
  };

  // Normalize items
  const rawItems = Array.isArray(data.items) ? data.items : [];
  const items = rawItems.map((item, i) => ({
    sno:  item.sno ?? item.serialNumber ?? (i + 1),
    name: item.name || item.productName || '',
    qty:  item.quantity ?? item.qty ?? '',
    price: item.price ?? item.unitPrice ?? null,
    total: item.total ?? item.totalPrice ?? item.totalAmount ?? null,
  }));

  // Pad to at least 4 rows
  while (items.length < 4) items.push({ sno: '', name: '', qty: '', price: null, total: null });

  let top = doc.y;

  // ── Header row ──
  border(L, top, W, rowH);
  vlines(top, rowH);
  cols.forEach(c => cell(c.label, colMap[c.key], top, c.w, rowH, 'center', true, 9));
  top += rowH;

  // ── Data rows ──
  items.forEach(item => {
    border(L, top, W, rowH);
    vlines(top, rowH);
    cell(item.sno,  colMap.sno,     top, cols[0].w, rowH, 'center');
    cell(item.name, colMap.product, top, cols[1].w, rowH, 'left');
    cell(item.qty != null && item.qty !== '' ? item.qty : '',
         colMap.qty, top, cols[2].w, rowH, 'center');
    cell(item.price != null ? fmtCurrency(item.price) : '',
         colMap.price, top, cols[3].w, rowH, 'right');
    cell(item.total != null ? fmtCurrency(item.total) : '',
         colMap.total, top, cols[4].w, rowH, 'right');
    top += rowH;
  });

  // ── TOTAL row ──
  const computedTotal = data.totalAmount || data.grandTotal ||
    rawItems.reduce((s, i) => s + Number(i.total || i.totalPrice || 0), 0);

  border(L, top, W, rowH);
  vlines(top, rowH);
  // "TOTAL" spans first 2 cols
  const span2W = cols[0].w + cols[1].w;
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(10);
  doc.text('TOTAL', L + 4, top + (rowH - 10) / 2, { width: span2W - 8, align: 'center', lineBreak: false });
  // total value in last col
  cell(computedTotal ? fmtCurrency(computedTotal) : '', colMap.total, top, cols[4].w, rowH, 'right', true);
  top += rowH;

  // ── Grand Total row ──
  border(L, top, W, grandH);
  vlines(top, grandH);
  const labelW = W - cols[4].w;
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(12);
  doc.text('Grand Total', L + 4, top + (grandH - 12) / 2, { width: labelW - 8, align: 'right', lineBreak: false });
  cell(computedTotal ? fmtCurrency(computedTotal) : '', colMap.total, top, cols[4].w, grandH, 'right', true, 10);
  top += grandH;

  doc.y = top + 8;
}

// ─── Footer ──────────────────────────────────────────────────────────────────

function drawFooter(doc, L, W) {
  doc.fillColor('#555').font('Helvetica').fontSize(8.5);
  doc.text('This is a computer-generated invoice.', L, doc.y, { width: W, align: 'center', lineBreak: false });

  doc.y += 40;

  doc.fillColor('#000').font('Helvetica-Bold').fontSize(11);
  doc.text('***Thank you for purchase!***', L, doc.y, { width: W, align: 'center', lineBreak: false });
}

module.exports = { generateInvoicePDF };
