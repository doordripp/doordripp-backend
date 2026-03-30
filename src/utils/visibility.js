const { RETAILER_VISIBILITY } = require('../config/visibility');

/**
 * Checks if retailer products should be visible now based on current time.
 * In development mode, always show all products. In production, use time-based logic.
 * @returns {boolean}
 */
const shouldShowRetailerProducts = () => {
  // In development mode, always show all products
  if (process.env.NODE_ENV === 'development' || process.env.ALWAYS_SHOW_ALL_PRODUCTS === 'true') {
    return true;
  }

  // Production: Use Indian Standard Time (IST) as specified by the user's environment
  const now = new Date();
  const options = { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' };
  const currentHour = parseInt(new Intl.DateTimeFormat('en-US', options).format(now));
  
  return currentHour >= RETAILER_VISIBILITY.START_HOUR && currentHour < RETAILER_VISIBILITY.END_HOUR;
};

/**
 * Returns a MongoDB filter for product visibility.
 * In development, returns empty filter (show all).
 * In production, filters out 'Retailer' products if outside visibility hours.
 * @returns {object}
 */
const getVisibilityFilter = () => {
  // We no longer filter out products at the DB level to avoid products appearing "lost".
  // Visibility logic should be handled by the frontend (displaying "Closed" status) 
  // or at the checkout level to prevent orders.
  return {};
};

module.exports = {
  shouldShowRetailerProducts,
  getVisibilityFilter
};
