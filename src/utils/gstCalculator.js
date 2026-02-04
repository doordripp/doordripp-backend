/**
 * GST Calculator Utility
 * Handles CGST/SGST/IGST calculations as per Indian GST rules
 */

// State code mapping (for reference)
const STATE_CODES = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '25': 'Daman and Diu',
  '26': 'Dadra and Nagar Haveli',
  '27': 'Maharashtra',
  '28': 'Andhra Pradesh (Old)',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh (New)',
  '38': 'Ladakh'
};

/**
 * Calculate GST for a line item
 * @param {Object} params - Calculation parameters
 * @param {Number} params.taxableAmount - Amount before GST
 * @param {Number} params.gstRate - GST rate (5, 12, 18, 28, etc.)
 * @param {String} params.sellerStateCode - Seller's state code
 * @param {String} params.buyerStateCode - Buyer's state code
 * @returns {Object} GST breakdown
 */
function calculateItemGST({ taxableAmount, gstRate, sellerStateCode, buyerStateCode }) {
  if (!taxableAmount || taxableAmount <= 0) {
    throw new Error('Taxable amount must be greater than 0');
  }
  
  if (!gstRate || gstRate < 0) {
    throw new Error('GST rate must be 0 or positive');
  }
  
  if (!sellerStateCode || !buyerStateCode) {
    throw new Error('Seller and buyer state codes are required');
  }
  
  const isIntraState = sellerStateCode === buyerStateCode;
  
  // Calculate total GST amount
  const totalGSTAmount = roundToTwo((taxableAmount * gstRate) / 100);
  
  let result = {
    taxableAmount: roundToTwo(taxableAmount),
    gstRate,
    isIntraState,
    cgst: 0,
    cgstRate: 0,
    sgst: 0,
    sgstRate: 0,
    igst: 0,
    igstRate: 0,
    totalGST: totalGSTAmount,
    totalAmount: roundToTwo(taxableAmount + totalGSTAmount)
  };
  
  if (isIntraState) {
    // Intra-state: Apply CGST + SGST (split equally)
    const halfRate = gstRate / 2;
    const halfAmount = totalGSTAmount / 2;
    
    result.cgst = roundToTwo(halfAmount);
    result.cgstRate = halfRate;
    result.sgst = roundToTwo(halfAmount);
    result.sgstRate = halfRate;
  } else {
    // Inter-state: Apply IGST
    result.igst = totalGSTAmount;
    result.igstRate = gstRate;
  }
  
  return result;
}

/**
 * Calculate GST for multiple items (invoice level)
 * @param {Array} items - Array of items with taxableAmount and gstRate
 * @param {String} sellerStateCode - Seller's state code
 * @param {String} buyerStateCode - Buyer's state code
 * @returns {Object} Aggregated GST breakdown
 */
function calculateInvoiceGST(items, sellerStateCode, buyerStateCode) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Items array is required');
  }
  
  let totalTaxable = 0;
  let totalCGST = 0;
  let totalSGST = 0;
  let totalIGST = 0;
  
  const itemsWithGST = items.map((item) => {
    const gstCalc = calculateItemGST({
      taxableAmount: item.taxableAmount || item.taxableValue,
      gstRate: item.gstRate,
      sellerStateCode,
      buyerStateCode
    });
    
    totalTaxable += gstCalc.taxableAmount;
    totalCGST += gstCalc.cgst;
    totalSGST += gstCalc.sgst;
    totalIGST += gstCalc.igst;
    
    return {
      ...item,
      ...gstCalc
    };
  });
  
  const totalGST = totalCGST + totalSGST + totalIGST;
  const totalAmount = totalTaxable + totalGST;
  
  return {
    items: itemsWithGST,
    summary: {
      totalTaxable: roundToTwo(totalTaxable),
      totalCGST: roundToTwo(totalCGST),
      totalSGST: roundToTwo(totalSGST),
      totalIGST: roundToTwo(totalIGST),
      totalGST: roundToTwo(totalGST),
      totalAmount: roundToTwo(totalAmount),
      isIntraState: sellerStateCode === buyerStateCode
    }
  };
}

/**
 * Round to 2 decimal places
 * @param {Number} value 
 * @returns {Number}
 */
function roundToTwo(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Calculate round-off adjustment
 * Rounds total to nearest whole number
 * @param {Number} amount 
 * @returns {Object} { roundedAmount, roundOffAdjustment }
 */
function calculateRoundOff(amount) {
  const rounded = Math.round(amount);
  const adjustment = roundToTwo(rounded - amount);
  
  return {
    originalAmount: roundToTwo(amount),
    roundedAmount: rounded,
    roundOffAdjustment: adjustment
  };
}

/**
 * Extract state code from GSTIN
 * @param {String} gstin - 15-character GSTIN
 * @returns {String} - 2-character state code
 */
function extractStateCodeFromGSTIN(gstin) {
  if (!gstin || gstin.length < 2) {
    throw new Error('Invalid GSTIN');
  }
  return gstin.substring(0, 2);
}

/**
 * Validate GSTIN format (basic check)
 * @param {String} gstin 
 * @returns {Boolean}
 */
function validateGSTIN(gstin) {
  if (!gstin) return false;
  
  // GSTIN format: 2 digits state code + 10 alphanumeric + 1 alpha + 1 Z + 1 alphanumeric
  const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
  return gstinRegex.test(gstin);
}

/**
 * Get state name from state code
 * @param {String} stateCode 
 * @returns {String}
 */
function getStateName(stateCode) {
  return STATE_CODES[stateCode] || 'Unknown';
}

module.exports = {
  calculateItemGST,
  calculateInvoiceGST,
  calculateRoundOff,
  extractStateCodeFromGSTIN,
  validateGSTIN,
  getStateName,
  roundToTwo,
  STATE_CODES
};
