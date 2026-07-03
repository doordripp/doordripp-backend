const Cart = require('../models/Cart');
const Product = require('../models/Product');
const mongoose = require('mongoose');
const { ALL_PRODUCTS = [] } = require('../data/frontendProducts');
const {
  validateProductAvailability,
  buildCartStockSnapshot
} = require('../utils/stockValidation');

const escapeRegex = require('../utils/escapeRegex');

const LEGACY_PRODUCT_NAME_BY_ID = ALL_PRODUCTS.reduce((acc, product) => {
  if (product?.id && product?.name) acc[product.id] = product.name;
  return acc;
}, {});

const resolveProductId = async (rawProductId) => {
  if (!rawProductId) return null;

  const candidate = String(rawProductId).trim();
  if (!candidate) return null;
  

  if (mongoose.Types.ObjectId.isValid(candidate)) {
    const exists = await Product.exists({ _id: candidate });
    return exists ? candidate : null;
  }

  const bySlug = await Product.findOne({ slug: candidate }).select('_id').lean();
  if (bySlug?._id) return String(bySlug._id);

  const legacyName = LEGACY_PRODUCT_NAME_BY_ID[candidate];
  if (legacyName) {
    const byName = await Product.findOne({
      name: { $regex: `^${escapeRegex(legacyName)}$`, $options: 'i' }
    }).select('_id').lean();
    if (byName?._id) return String(byName._id);
  }

  return null;
};

exports.getCart = async (req, res, next) => {
  try {
    const userId = req.user.id;
    let cart = await Cart.findOne({ user: userId }).populate('items.product');
    if (!cart) {
      cart = await Cart.create({ user: userId, items: [] });
    }
    res.json(cart);
  } catch (err) {
    next(err);
  }
};

exports.addItem = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { productId, quantity = 1, size = 'M', color = 'default' } = req.body;
    if (!productId) return res.status(400).json({ error: 'productId required' });

    const resolvedProductId = await resolveProductId(productId);
    if (!resolvedProductId) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const product = await Product.findById(resolvedProductId);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const requestedQty = Math.max(1, parseInt(quantity) || 1);

    let cart = await Cart.findOne({ user: userId });
    if (!cart) {
      cart = await Cart.create({ user: userId, items: [] });
    }

    const existing = cart.items.find(i =>
      i.product.toString() === resolvedProductId &&
      i.size === size &&
      i.color === color
    );

    const existingQty = existing ? existing.quantity : 0;
    const availability = validateProductAvailability(product, existingQty + requestedQty, { size });
    if (!availability.ok) {
      const statusCode = availability.reason === 'retailer_unavailable' ? 403 : 400;
      return res.status(statusCode).json({ error: availability.message || 'Out of stock' });
    }

    if (existing) {
      existing.quantity += requestedQty;
    } else {
      cart.items.push({ product: resolvedProductId, quantity: requestedQty, size, color });
    }

    await cart.save();
    const updated = await Cart.findOne({ user: userId }).populate('items.product');
    res.json(updated);
  } catch (err) {
    next(err);
  }
};

exports.updateQuantity = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { productId, quantity, size = 'M', color = 'default' } = req.body;

    if (!productId) return res.status(400).json({ error: 'productId required' });
    if (typeof quantity !== 'number') return res.status(400).json({ error: 'quantity required' });

    const resolvedProductId = await resolveProductId(productId);
    if (!resolvedProductId) return res.status(404).json({ error: 'Product not found' });

    let cart = await Cart.findOne({ user: userId });
    if (!cart) return res.status(404).json({ error: 'Cart not found' });

    const existing = cart.items.find(i =>
      i.product.toString() === resolvedProductId &&
      i.size === size &&
      i.color === color
    );

    if (!existing) return res.status(404).json({ error: 'Item not in cart' });

    if (quantity <= 0) {
      cart.items = cart.items.filter(i => i !== existing);
    } else {
      const product = await Product.findById(resolvedProductId);
      if (product) {
        const availability = validateProductAvailability(product, quantity, { size });
        if (!availability.ok) {
          const statusCode = availability.reason === 'retailer_unavailable' ? 403 : 400;
          return res.status(statusCode).json({ error: availability.message || 'Out of stock' });
        }
      }
      existing.quantity = quantity;
    }

    await cart.save();
    const updated = await Cart.findOne({ user: userId }).populate('items.product');
    res.json(updated);
  } catch (err) {
    next(err);
  }
}

exports.removeItem = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { productId, size = 'M', color = 'default' } = req.body;
    if (!productId) return res.status(400).json({ error: 'productId required' });

    const resolvedProductId = await resolveProductId(productId);
    if (!resolvedProductId) return res.status(404).json({ error: 'Product not found' });

    const cart = await Cart.findOne({ user: userId });
    if (!cart) return res.status(404).json({ error: 'Cart not found' });

    cart.items = cart.items.filter(i =>
      !(i.product.toString() === resolvedProductId && i.size === size && i.color === color)
    );
    await cart.save();

    const updated = await Cart.findOne({ user: userId }).populate('items.product');
    res.json(updated);
  } catch (err) {
    next(err);
  }
};

exports.syncCart = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { items = [] } = req.body; // Array of { id, quantity, selectedSize, selectedColor }

    let cart = await Cart.findOne({ user: userId });
    if (!cart) {
      cart = await Cart.create({ user: userId, items: [] });
    }

    // Replace current cart items with sync content or merge? 
    // Usually on login, we might want to merge, but simple replacement is easier to manage if frontend holds the truth.
    // Let's go with replacement for consistency.
    const syncedItems = await Promise.all(items.map(async (item) => {
      const rawId = item?.id || item?.productId;
      const resolvedProductId = await resolveProductId(rawId);
      if (!resolvedProductId) return null;

      const quantity = Math.max(1, parseInt(item?.quantity, 10) || 1);
      return {
        product: resolvedProductId,
        quantity,
        size: item?.selectedSize || item?.size || 'M',
        color: item?.selectedColor || item?.color || 'default'
      };
    }));

    const newItems = syncedItems.filter(Boolean);

    cart.items = newItems;
    await cart.save();

    const updated = await Cart.findOne({ user: userId }).populate('items.product');
    res.json(updated);
  } catch (err) {
    next(err);
  }
}

exports.clearCart = async (req, res, next) => {
  try {
    const userId = req.user.id;
    let cart = await Cart.findOne({ user: userId });
    if (cart) {
      cart.items = [];
      await cart.save();
    }
    res.json({ success: true, items: [] });
  } catch (err) {
    next(err);
  }
}

exports.checkout = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const cart = await Cart.findOne({ user: userId }).populate('items.product');
    if (!cart || !cart.items.length) return res.status(400).json({ error: 'Cart is empty' });

    res.json({
      success: true,
      message: 'Cart details captured successfully',
      items: buildCartStockSnapshot(cart.items).items
    });
  } catch (err) {
    next(err);
  }
};

module.exports = exports;
