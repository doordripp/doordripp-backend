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
    const { productId, quantity = 1 } = req.body;
    if (!productId) return res.status(400).json({ error: 'productId required' });
    
    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    
    const requestedQty = Math.max(1, parseInt(quantity) || 1);

    let cart = await Cart.findOne({ user: userId });
    if (!cart) {
      cart = await Cart.create({ user: userId, items: [] });
    }
    
    const existing = cart.items.find(i => i.product.toString() === productId);
    const existingQty = existing ? existing.quantity : 0;
    if (product.stock <= 0 || existingQty + requestedQty > product.stock) {
      return res.status(400).json({ error: 'Out of stock' });
    }
    if (existing) {
      existing.quantity += requestedQty;
    } else {
      cart.items.push({ product: productId, quantity: requestedQty });
    }
    
    await cart.save();
    const updated = await Cart.findOne({ user: userId }).populate('items.product');
    res.json(updated);
  } catch (err) {
    next(err);
  }
};

exports.removeItem = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { productId } = req.body;
    if (!productId) return res.status(400).json({ error: 'productId required' });
    
    const cart = await Cart.findOne({ user: userId });
    if (!cart) return res.status(404).json({ error: 'Cart not found' });
    
    cart.items = cart.items.filter(i => i.product.toString() !== productId);
    await cart.save();
    
    const updated = await Cart.findOne({ user: userId }).populate('items.product');
    res.json(updated);
  } catch (err) {
    next(err);
  }
};

exports.checkout = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { shippingAddress } = req.body;
    const cart = await Cart.findOne({ user: userId }).populate('items.product');
    if (!cart || !cart.items.length) return res.status(400).json({ error: 'Cart is empty' });

    // validate stock & compute total
    let total = 0;
    const orderItems = [];
    for (const it of cart.items) {
      const product = it.product;
      if (!product) return res.status(400).json({ error: 'Invalid product in cart' });
      if (product.stock < it.quantity) return res.status(400).json({ error: `Out of stock for ${product.name}` });
      total += product.price * it.quantity;
      orderItems.push({ product: product._id, name: product.name, quantity: it.quantity, price: product.price });
    }

    // Create Razorpay order if configured
    const RazorpayUtil = require('../utils/razorpay');
    let razorOrder = null;
    try {
      razorOrder = await RazorpayUtil.createOrder({ amount: Math.round(total * 100), currency: 'INR' });
    } catch (e) {
      // If Razorpay not configured, continue without razorpay
      razorOrder = null;
    }

    // Create order in DB
    const Order = require('../models/Order');
    const order = await Order.create({
      customer: userId,
      items: orderItems,
      total,
      status: 'pending',
      payment: razorOrder ? { razorpayOrderId: razorOrder.id } : {},
      shippingAddress
    });

    // Reduce stock
    for (const it of cart.items) {
      await Product.findByIdAndUpdate(it.product._id, { $inc: { stock: -it.quantity } });
    }

    // Clear cart
    cart.items = [];
    await cart.save();

    res.status(201).json({ order, razorOrder });
  } catch (err) {
    next(err);
  }
};

module.exports = exports;
