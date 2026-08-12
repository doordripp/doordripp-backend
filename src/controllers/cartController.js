const Cart = require('../models/Cart');
const Product = require('../models/Product');
const mongoose = require('mongoose');
const escapeRegex = require('../utils/escapeRegex');
const { validateProductAvailability } = require('../utils/stockValidation');
const LEGACY_PRODUCT_NAME_BY_ID = {};

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
    let cart = await Cart.findOneAndUpdate(
      { user: userId },
      { $setOnInsert: { user: userId, items: [] } },
      { new: true, upsert: true }
    ).populate('items.product');
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

    let cart = await Cart.findOneAndUpdate(
      { user: userId },
      { $setOnInsert: { user: userId, items: [] } },
      { new: true, upsert: true }
    );

    const existing = cart.items.find(i =>
      i.product && i.product.toString() === resolvedProductId &&
      i.size === size &&
      i.color === color
    );

    const existingQty = existing ? existing.quantity : 0;
    const availability = validateProductAvailability(product, existingQty + requestedQty, { size });
    if (!availability.ok) {
      const statusCode = availability.reason === 'retailer_unavailable' ? 403 : 400;
      return res.status(statusCode).json({ error: availability.message || 'Out of stock' });
    }

    let updatedCart;
    if (existing) {
      updatedCart = await Cart.findOneAndUpdate(
        { user: userId, 'items._id': existing._id },
        { $inc: { 'items.$.quantity': requestedQty } },
        { new: true }
      ).populate('items.product');
    } else {
      updatedCart = await Cart.findOneAndUpdate(
        { user: userId },
        { $push: { items: { product: resolvedProductId, quantity: requestedQty, size, color } } },
        { new: true, upsert: true }
      ).populate('items.product');
    }

    res.json(updatedCart);
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

    if (quantity <= 0) {
      const updated = await Cart.findOneAndUpdate(
        { user: userId },
        { $pull: { items: { product: resolvedProductId, size, color } } },
        { new: true }
      ).populate('items.product');
      return res.json(updated || { user: userId, items: [] });
    }

    const product = await Product.findById(resolvedProductId);
    if (product) {
      const availability = validateProductAvailability(product, quantity, { size });
      if (!availability.ok) {
        const statusCode = availability.reason === 'retailer_unavailable' ? 403 : 400;
        return res.status(statusCode).json({ error: availability.message || 'Out of stock' });
      }
    }

    let updated = await Cart.findOneAndUpdate(
      { user: userId, 'items.product': resolvedProductId, 'items.size': size, 'items.color': color },
      { $set: { 'items.$.quantity': quantity } },
      { new: true }
    ).populate('items.product');

    if (!updated) {
      updated = await Cart.findOneAndUpdate(
        { user: userId },
        { $push: { items: { product: resolvedProductId, quantity, size, color } } },
        { new: true, upsert: true }
      ).populate('items.product');
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
};

exports.removeItem = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { productId, size = 'M', color = 'default' } = req.body;
    if (!productId) return res.status(400).json({ error: 'productId required' });

    const resolvedProductId = await resolveProductId(productId);
    if (!resolvedProductId) return res.status(404).json({ error: 'Product not found' });

    const updated = await Cart.findOneAndUpdate(
      { user: userId },
      { $pull: { items: { product: resolvedProductId, size, color } } },
      { new: true }
    ).populate('items.product');

    res.json(updated || { user: userId, items: [] });
  } catch (err) {
    next(err);
  }
};

exports.syncCart = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { items = [] } = req.body; // Array of { id, quantity, selectedSize, selectedColor }

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

    const updated = await Cart.findOneAndUpdate(
      { user: userId },
      { $set: { items: newItems } },
      { new: true, upsert: true }
    ).populate('items.product');

    res.json(updated);
  } catch (err) {
    next(err);
  }
};

exports.clearCart = async (req, res, next) => {
  try {
    const userId = req.user.id;
    await Cart.findOneAndUpdate(
      { user: userId },
      { $set: { items: [] } },
      { upsert: true }
    );
    res.json({ success: true, items: [] });
  } catch (err) {
    next(err);
  }
};

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
