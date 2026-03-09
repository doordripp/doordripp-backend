const Cart = require('../models/Cart');
const Product = require('../models/Product');

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

    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const requestedQty = Math.max(1, parseInt(quantity) || 1);

    let cart = await Cart.findOne({ user: userId });
    if (!cart) {
      cart = await Cart.create({ user: userId, items: [] });
    }

    const existing = cart.items.find(i =>
      i.product.toString() === productId &&
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
      cart.items.push({ product: productId, quantity: requestedQty, size, color });
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

    let cart = await Cart.findOne({ user: userId });
    if (!cart) return res.status(404).json({ error: 'Cart not found' });

    const existing = cart.items.find(i =>
      i.product.toString() === productId &&
      i.size === size &&
      i.color === color
    );

    if (!existing) return res.status(404).json({ error: 'Item not in cart' });

    if (quantity <= 0) {
      cart.items = cart.items.filter(i => i !== existing);
    } else {
      const product = await Product.findById(productId);
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

    const cart = await Cart.findOne({ user: userId });
    if (!cart) return res.status(404).json({ error: 'Cart not found' });

    cart.items = cart.items.filter(i =>
      !(i.product.toString() === productId && i.size === size && i.color === color)
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
    const newItems = items.map(item => ({
      product: item.id || item.productId,
      quantity: item.quantity,
      size: item.selectedSize || item.size || 'M',
      color: item.selectedColor || item.color || 'default'
    }));

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
