const Cart = require('../models/Cart');
const Product = require('../models/Product');
const mongoose = require('mongoose');
const { ALL_PRODUCTS = [] } = require('../data/frontendProducts');

const escapeRegex = (value = '') => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const LEGACY_PRODUCT_NAME_BY_ID = ALL_PRODUCTS.reduce((acc, product) => {
  if (product?.id && product?.name) acc[product.id] = product.name;
  return acc;
}, {});

const resolveProductId = async (rawProductId) => {
  if (!rawProductId) return null;

  const candidate = String(rawProductId).trim();
  if (!candidate) return null;
  //test webhook-backend

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

    // Visibility check for Retailer products
    const { shouldShowRetailerProducts } = require('../utils/visibility');
    if (product.productSource === 'Retailer' && !shouldShowRetailerProducts()) {
      return res.status(403).json({ error: 'This product is currently not available for purchase.' });
    }

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
    if (product.stock <= 0 || existingQty + requestedQty > product.stock) {
      return res.status(400).json({ error: 'Out of stock' });
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
      if (product && quantity > product.stock) {
        return res.status(400).json({ error: 'Out of stock' });
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
    const { shippingAddress } = req.body;
    const cart = await Cart.findOne({ user: userId }).populate('items.product');
    if (!cart || !cart.items.length) return res.status(400).json({ error: 'Cart is empty' });

    let total = 0;
    const orderItems = [];
    for (const it of cart.items) {
      const product = it.product;
      if (!product) continue;

      // Visibility check for Retailer products
      const { shouldShowRetailerProducts } = require('../utils/visibility');
      if (product.productSource === 'Retailer' && !shouldShowRetailerProducts()) {
        return res.status(400).json({ error: `${product.name} is currently not available for purchase outside business hours (8 AM - 10 PM). Please remove it from your cart or check out during business hours.` });
      }

      if (product.stock < it.quantity) return res.status(400).json({ error: `Out of stock for ${product.name}` });
      total += product.price * it.quantity;
      orderItems.push({
        product: product._id,
        name: product.name,
        quantity: it.quantity,
        price: product.price,
        size: it.size,
        color: it.color
      });
    }

    const RazorpayUtil = require('../utils/razorpay');
    let razorOrder = null;
    try {
      razorOrder = await RazorpayUtil.createOrder({ amount: Math.round(total * 100), currency: 'INR' });
    } catch (e) {
      razorOrder = null;
    }

    const Order = require('../models/Order');
    const order = await Order.create({
      customer: userId,
      items: orderItems,
      total,
      status: 'pending',
      payment: razorOrder ? { razorpayOrderId: razorOrder.id } : {},
      shippingAddress
    });

    for (const it of cart.items) {
      await Product.findByIdAndUpdate(it.product._id, { $inc: { stock: -it.quantity } });
    }

    cart.items = [];
    await cart.save();

    res.status(201).json({ order, razorOrder });
  } catch (err) {
    next(err);
  }
};

module.exports = exports;
