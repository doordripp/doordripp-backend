const normalizeSizeLabel = (value = '') => String(value || '').trim();

const toSafeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeSizeInventory = (sizeInventory = [], fallbackSizes = [], fallbackStock = 0) => {
  const inventoryMap = new Map();

  if (Array.isArray(sizeInventory)) {
    sizeInventory.forEach((entry) => {
      const size = normalizeSizeLabel(entry?.size);
      if (!size) return;
      inventoryMap.set(size, Math.max(0, Math.trunc(toSafeNumber(entry?.stock, 0))));
    });
  }

  if (inventoryMap.size === 0 && Array.isArray(fallbackSizes) && fallbackSizes.length > 0) {
    fallbackSizes
      .map(normalizeSizeLabel)
      .filter(Boolean)
      .forEach((size, index) => {
        const stock = index === 0 ? Math.max(0, Math.trunc(toSafeNumber(fallbackStock, 0))) : 0;
        inventoryMap.set(size, stock);
      });
  }

  if (inventoryMap.size === 0 && toSafeNumber(fallbackStock, 0) > 0) {
    inventoryMap.set('M', Math.max(0, Math.trunc(toSafeNumber(fallbackStock, 0))));
  }

  return Array.from(inventoryMap.entries()).map(([size, stock]) => ({ size, stock }));
};

const getTotalStock = (sizeInventory = []) =>
  normalizeSizeInventory(sizeInventory).reduce((sum, entry) => sum + Math.max(0, Number(entry.stock || 0)), 0);

const getAvailableSizes = (sizeInventory = []) =>
  normalizeSizeInventory(sizeInventory)
    .filter((entry) => Number(entry.stock || 0) > 0)
    .map((entry) => entry.size);

const getDefaultSize = (sizeInventory = [], fallbackSizes = []) => {
  const normalizedInventory = normalizeSizeInventory(sizeInventory, fallbackSizes);
  const inStock = normalizedInventory.find((entry) => Number(entry.stock || 0) > 0);
  if (inStock?.size) return inStock.size;
  return normalizedInventory[0]?.size || normalizeSizeLabel(fallbackSizes?.[0]) || 'M';
};

const getSizeStock = (product, requestedSize) => {
  const normalizedSize = normalizeSizeLabel(requestedSize);
  const normalizedInventory = normalizeSizeInventory(
    product?.sizeInventory,
    product?.sizes,
    product?.stock
  );

  if (normalizedInventory.length === 0) {
    return Math.max(0, Math.trunc(toSafeNumber(product?.stock, 0) - toSafeNumber(product?.reserved, 0)));
  }

  const fallbackSize = getDefaultSize(normalizedInventory);
  const effectiveSize = normalizedSize || fallbackSize;
  const match = normalizedInventory.find((entry) => entry.size === effectiveSize);
  return Math.max(0, Number(match?.stock || 0));
};

const buildProductInventoryPayload = (product) => {
  const sizeInventory = normalizeSizeInventory(product?.sizeInventory, product?.sizes, product?.stock);
  const sizes = sizeInventory.map((entry) => entry.size);
  const stock = getTotalStock(sizeInventory);
  const availableSizes = getAvailableSizes(sizeInventory);
  const defaultSize = getDefaultSize(sizeInventory, sizes);

  return {
    sizeInventory,
    sizes,
    stock,
    availableSizes,
    defaultSize,
    inStock: stock > 0
  };
};

module.exports = {
  normalizeSizeLabel,
  normalizeSizeInventory,
  getTotalStock,
  getAvailableSizes,
  getDefaultSize,
  getSizeStock,
  buildProductInventoryPayload
};
