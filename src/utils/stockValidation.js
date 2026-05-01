const { shouldShowRetailerProducts } = require('./visibility');
const { getSizeStock, getDefaultSize, normalizeSizeLabel } = require('./productInventory');

const getAvailableStock = (product) => {
  return getSizeStock(product, getDefaultSize(product?.sizeInventory, product?.sizes));
};

const validateProductAvailability = (product, quantity = 1, options = {}) => {
  const requestedQuantity = Math.max(1, Number(quantity) || 1);
  const selectedSize = normalizeSizeLabel(options.size || options.selectedSize || '');
  const defaultSize = getDefaultSize(product?.sizeInventory, product?.sizes);
  const effectiveSize = selectedSize || defaultSize;
  const availableStock = getSizeStock(product, effectiveSize);
  const enforceVisibility = options.enforceVisibility !== false;

  if (!product) {
    return {
      ok: false,
      reason: 'missing_product',
      requestedQuantity,
      availableStock: 0,
      size: effectiveSize,
      message: 'Product not found'
    };
  }

  if (
    enforceVisibility &&
    product.productSource === 'Retailer' &&
    !shouldShowRetailerProducts()
  ) {
    return {
      ok: false,
      reason: 'retailer_unavailable',
      requestedQuantity,
      availableStock,
      size: effectiveSize,
      message: `${product.name} is currently not available for purchase outside business hours (8 AM - 10 PM). Please remove it from your cart or check out during business hours.`
    };
  }

  if (availableStock < requestedQuantity) {
    return {
      ok: false,
      reason: 'out_of_stock',
      requestedQuantity,
      availableStock,
      size: effectiveSize,
      message:
        availableStock > 0
          ? `Out of stock for "${product.name}" in size ${effectiveSize}. Only ${availableStock} left.`
          : `Out of stock for "${product.name}" in size ${effectiveSize}.`
    };
  }

  return {
    ok: true,
    reason: null,
    requestedQuantity,
    availableStock,
    size: effectiveSize,
    message: ''
  };
};

const buildCartStockSnapshot = (cartItems = []) => {
  const items = [];
  const invalidItems = [];

  for (const item of cartItems) {
    const product = item?.product;
    const validation = validateProductAvailability(product, item?.quantity, { size: item?.size });
    const snapshot = {
      productId: product?._id ? String(product._id) : null,
      name: product?.name || 'Unknown product',
      size: validation.size || item?.size || 'M',
      color: item?.color || 'default',
      requestedQuantity: validation.requestedQuantity,
      availableStock: validation.availableStock,
      isAvailable: validation.ok,
      reason: validation.reason,
      message: validation.message
    };

    items.push(snapshot);
    if (!validation.ok) invalidItems.push(snapshot);
  }

  return {
    isValid: invalidItems.length === 0,
    items,
    invalidItems
  };
};

module.exports = {
  getAvailableStock,
  validateProductAvailability,
  buildCartStockSnapshot
};
