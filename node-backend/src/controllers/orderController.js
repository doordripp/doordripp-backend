const prisma = require('../config/prisma');
const RazorpayUtil = require('../utils/razorpay');

exports.create = async (req, res, next) => {
  try {
    const { items, shippingAddress } = req.body;
    if (!items || !items.length) return res.status(400).json({ error: 'No items' });

    // build order items and calculate total
    let total = 0;
    const orderItems = [];
    for (const it of items) {
      const product = await prisma.product.findUnique({ where: { id: it.product } });
      if (!product) return res.status(400).json({ error: 'Invalid product ' + it.product });
      if (product.stock < it.quantity) return res.status(400).json({ error: 'Out of stock for ' + product.name });
      const price = product.price;
      total += price * it.quantity;
      orderItems.push({ productId: product.id, name: product.name, quantity: it.quantity, price });
    }

    // create a Razorpay order (amount in paise)
    const razorOrder = await RazorpayUtil.createOrder({ amount: Math.round(total * 100), currency: 'INR' });

    const order = await prisma.order.create({ data: {
      customerId: req.user.id,
      total,
      status: 'PENDING',
      payment: { razorpayOrderId: razorOrder.id },
      shippingAddress,
      items: { create: orderItems.map(oi => ({ productId: oi.productId, name: oi.name, quantity: oi.quantity, price: oi.price })) }
    }, include: { items: true } });

    // reduce stock
    for (const it of orderItems) {
      await prisma.product.update({ where: { id: it.productId }, data: { stock: { decrement: it.quantity } } });
    }

    res.status(201).json({ order, razorOrder });
  } catch (err) {
    next(err);
  }
};

exports.get = async (req, res, next) => {
  try {
    const order = await prisma.order.findUnique({ where: { id: req.params.id }, include: { items: { include: { product: true } }, customer: true } });
    if (!order) return res.status(404).json({ error: 'Not found' });
    if (String(order.customerId) !== String(req.user.id) && !req.user.roles.includes('ADMIN'))
      return res.status(403).json({ error: 'Forbidden' });
    res.json(order);
  } catch (err) {
    next(err);
  }
};
