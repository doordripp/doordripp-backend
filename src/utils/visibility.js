const { RETAILER_VISIBILITY } = require('../config/visibility');

/**
 * Checks if retailer products should be visible now based on current time.
 * @returns {boolean}
 */
const shouldShowRetailerProducts = () => {
  // Use Indian Standard Time (IST) as specified by the user's environment
  const now = new Date();
  const options = { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' };
  const currentHour = parseInt(new Intl.DateTimeFormat('en-US', options).format(now));
  
  return currentHour >= RETAILER_VISIBILITY.START_HOUR && currentHour < RETAILER_VISIBILITY.END_HOUR;
};

/**
 * Returns a MongoDB filter for product visibility.
 * If retailer products are supposed to be hidden, it filter out 'Retailer' products.
 * @returns {object}
 */
const getVisibilityFilter = () => {
  if (shouldShowRetailerProducts()) {
    // Both Retailer and Manufacturer are visible
    return {};
  } else {
    // Only Manufacturer (or undefined) is visible
    return { productSource: { $ne: 'Retailer' } };
  }
};

module.exports = {
  shouldShowRetailerProducts,
  getVisibilityFilter
};
