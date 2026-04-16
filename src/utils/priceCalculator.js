/**
 * Unified Price Calculator Utility
 * 
 * All prices in the system are stored as INCLUSIVE of GST (MRP format)
 * This utility standardizes all price calculations across backend and frontend
 * 
 * Price Formula:
 *   - Inclusive Price (MRP/Display Price) = Taxable Amount * (1 + GST%/100)
 *   - Taxable Amount = Inclusive Price / (1 + GST%/100)
 *   - GST Amount = Inclusive Price - Taxable Amount
 */

const roundToTwo = (num) => Math.round(num * 100) / 100;

/**
 * Calculate price breakdown from inclusive (MRP) price
 * 
 * @param {number} inclusivePrice - The price shown to customer (includes GST)
 * @param {number} gstRate - GST rate percentage (5, 12, 18, 28, etc)
 * @returns {object} Breakdown of taxable amount, GST, CGST, SGST
 */
function calculateFromInclusivePrice(inclusivePrice, gstRate = 5) {
  if (!Number.isFinite(inclusivePrice) || inclusivePrice <= 0) {
    throw new Error('inclusivePrice must be a positive number');
  }
  if (!Number.isFinite(gstRate) || gstRate < 0) {
    throw new Error('gstRate must be a non-negative number');
  }

  // Taxable amount = Inclusive Price / (1 + GST/100)
  const taxableAmount = roundToTwo(inclusivePrice / (1 + gstRate / 100));
  
  // GST amount = Inclusive Price - Taxable Amount
  const gstAmount = roundToTwo(inclusivePrice - taxableAmount);
  
  // Split CGST and SGST equally (for intra-state)
  const cgst = roundToTwo(gstAmount / 2);
  const sgst = roundToTwo(gstAmount / 2);
  
  // Verify calculation
  const verifyInclusive = roundToTwo(taxableAmount + gstAmount);
  
  return {
    inclusivePrice: roundToTwo(inclusivePrice),
    taxableAmount,
    gstRate,
    gstAmount,
    cgst,
    cgstRate: gstRate / 2,
    sgst,
    sgstRate: gstRate / 2,
    igst: 0,
    igstRate: 0,
    // Should equal inclusivePrice (minor rounding may occur)
    verifiedInclusive: verifyInclusive
  };
}

/**
 * Calculate item total with quantity
 * 
 * @param {number} inclusivePrice - Price per unit (includes GST)
 * @param {number} quantity - Quantity of items
 * @param {number} gstRate - GST rate percentage
 * @returns {object} Item breakdown with totals
 */
function calculateItemTotal(inclusivePrice, quantity = 1, gstRate = 5) {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('quantity must be a positive number');
  }

  const singleItem = calculateFromInclusivePrice(inclusivePrice, gstRate);
  
  const itemTotalInclusive = roundToTwo(inclusivePrice * quantity);
  const itemTotalTaxable = roundToTwo(singleItem.taxableAmount * quantity);
  const itemTotalGst = roundToTwo(singleItem.gstAmount * quantity);
  const itemTotalCgst = roundToTwo(singleItem.cgst * quantity);
  const itemTotalSgst = roundToTwo(singleItem.sgst * quantity);

  return {
    quantity,
    unitInclusivePrice: roundToTwo(inclusivePrice),
    unitTaxableAmount: singleItem.taxableAmount,
    unitGst: singleItem.gstAmount,
    
    itemTotalInclusive,
    itemTotalTaxable,
    itemTotalGst,
    itemTotalCgst,
    itemTotalSgst,
    
    gstRate,
    cgstRate: gstRate / 2,
    sgstRate: gstRate / 2
  };
}

/**
 * Calculate order totals from array of items
 * 
 * @param {array} items - Array of items with 'price' (inclusive), 'quantity', and 'gstRate'
 * @returns {object} Order-level totals
 */
function calculateOrderTotals(items = []) {
  if (!Array.isArray(items)) {
    throw new Error('items must be an array');
  }

  let totalInclusive = 0;
  let totalTaxable = 0;
  let totalGst = 0;
  let totalCgst = 0;
  let totalSgst = 0;

  for (const item of items) {
    const price = Number(item.price || 0);
    const quantity = Number(item.quantity || 1);
    const gstRate = Number(item.gstRate || 5);

    if (price <= 0 || quantity <= 0) continue;

    const itemBreakdown = calculateItemTotal(price, quantity, gstRate);
    
    totalInclusive += itemBreakdown.itemTotalInclusive;
    totalTaxable += itemBreakdown.itemTotalTaxable;
    totalGst += itemBreakdown.itemTotalGst;
    totalCgst += itemBreakdown.itemTotalCgst;
    totalSgst += itemBreakdown.itemTotalSgst;
  }

  return {
    totalInclusive: roundToTwo(totalInclusive),
    totalTaxable: roundToTwo(totalTaxable),
    totalGst: roundToTwo(totalGst),
    totalCgst: roundToTwo(totalCgst),
    totalSgst: roundToTwo(totalSgst)
  };
}

/**
 * Calculate final order total with delivery and trial fees
 * 
 * @param {object} params - Configuration object
 * @returns {object} Complete pricing breakdown
 */
function calculateFinalTotal({
  items = [],
  deliveryFee = 0,
  trialFee = 0,
  voucherDiscount = 0
} = {}) {
  const itemTotals = calculateOrderTotals(items);
  
  const subtotalInclusive = itemTotals.totalInclusive;
  const subtotalTaxable = itemTotals.totalTaxable;
  
  const totalBeforeDiscount = roundToTwo(subtotalInclusive + (Number(deliveryFee) || 0) + (Number(trialFee) || 0));
  const discountAmount = Math.min(Number(voucherDiscount) || 0, subtotalInclusive);
  const finalTotal = roundToTwo(totalBeforeDiscount - discountAmount);

  return {
    // Subtotal breakdown
    subtotalInclusive: roundToTwo(subtotalInclusive),
    subtotalTaxable: roundToTwo(subtotalTaxable),
    subtotalGst: roundToTwo(itemTotals.totalGst),
    subtotalCgst: roundToTwo(itemTotals.totalCgst),
    subtotalSgst: roundToTwo(itemTotals.totalSgst),
    
    // Add-on fees
    deliveryFee: roundToTwo(deliveryFee),
    trialFee: roundToTwo(trialFee),
    
    // Discount
    voucherDiscount: roundToTwo(discountAmount),
    
    // Totals
    totalBeforeDiscount: roundToTwo(totalBeforeDiscount),
    finalTotal: roundToTwo(finalTotal)
  };
}

module.exports = {
  calculateFromInclusivePrice,
  calculateItemTotal,
  calculateOrderTotals,
  calculateFinalTotal,
  roundToTwo
};
