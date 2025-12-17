const Order = require('../models/Order');
const Product = require('../models/Product');
const RazorpayUtil = require('../utils/razorpay');

exports.create = async (req, res, next) => {
  try {
    const { items, shippingAddress } = req.body;
    if (!items || !items.length) return res.status(400).json({ error: 'No items' });

    // build order items and calculate total
    let total = 0;
    const orderItems = [];
    for (const it of items) {
      const product = await Product.findById(it.product);
      if (!product) return res.status(400).json({ error: 'Invalid product ' + it.product });
      if (product.stock < it.quantity) return res.status(400).json({ error: 'Out of stock for ' + product.name });
      const price = product.price;
      total += price * it.quantity;
      orderItems.push({ product: product._id, name: product.name, quantity: it.quantity, price });
    }

    // create a Razorpay order (amount in paise)
    const razorOrder = await RazorpayUtil.createOrder({ amount: Math.round(total * 100), currency: 'INR' });

    const order = await Order.create({
      customer: req.user.id,
      items: orderItems,
      total,
      status: 'pending',
      payment: { razorpayOrderId: razorOrder.id },
      shippingAddress
    });

    // reduce stock
    for (const it of orderItems) {
      await Product.findByIdAndUpdate(it.product, { $inc: { stock: -it.quantity } });
    }

    res.status(201).json({ order, razorOrder });
  } catch (err) {
    next(err);
  }
};

exports.get = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id).populate('customer').populate('items.product');
    if (!order) return res.status(404).json({ error: 'Not found' });
    if (String(order.customer._id) !== String(req.user.id) && !req.user.roles.includes('admin'))
      return res.status(403).json({ error: 'Forbidden' });
    res.json(order);
  } catch (err) {
    next(err);
  }
};

module.exports = exports;
