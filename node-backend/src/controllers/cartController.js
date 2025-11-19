const prisma = require('../config/prisma')
const RazorpayUtil = require('../utils/razorpay')

exports.getCart = async (req, res, next) => {
  try {
    const userId = req.user.id
    let cart = await prisma.cart.findUnique({ where: { userId }, include: { items: { include: { product: true } } } })
    if (!cart) {
      cart = await prisma.cart.create({ data: { userId, items: [] } , include: { items: { include: { product: true } } } })
    }
    res.json(cart)
  } catch (err) {
    next(err)
  }
}

exports.addItem = async (req, res, next) => {
  try {
    const userId = req.user.id
    const { productId, quantity = 1 } = req.body
    if (!productId) return res.status(400).json({ error: 'productId required' })
    const product = await prisma.product.findUnique({ where: { id: productId } })
    if (!product) return res.status(404).json({ error: 'Product not found' })
    let cart = await prisma.cart.findUnique({ where: { userId }, include: { items: true } })
    if (!cart) {
      cart = await prisma.cart.create({ data: { userId }, include: { items: true } })
    }
    const existing = cart.items.find(i => i.productId === productId)
    if (existing) {
      await prisma.cartItem.update({ where: { id: existing.id }, data: { quantity: existing.quantity + quantity } })
    } else {
      await prisma.cartItem.create({ data: { cartId: cart.id, productId, quantity } })
    }
    const updated = await prisma.cart.findUnique({ where: { userId }, include: { items: { include: { product: true } } } })
    res.json(updated)
  } catch (err) {
    next(err)
  }
}

exports.removeItem = async (req, res, next) => {
  try {
    const userId = req.user.id
    const { productId } = req.body
    if (!productId) return res.status(400).json({ error: 'productId required' })
    const cart = await prisma.cart.findUnique({ where: { userId }, include: { items: true } })
    if (!cart) return res.status(404).json({ error: 'Cart not found' })
    await prisma.cartItem.deleteMany({ where: { cartId: cart.id, productId } })
    const updated = await prisma.cart.findUnique({ where: { userId }, include: { items: { include: { product: true } } } })
    res.json(updated)
  } catch (err) {
    next(err)
  }
}

exports.checkout = async (req, res, next) => {
  try {
    const userId = req.user.id
    const { shippingAddress } = req.body
    const cart = await prisma.cart.findUnique({ where: { userId }, include: { items: { include: { product: true } } } })
    if (!cart || !cart.items.length) return res.status(400).json({ error: 'Cart is empty' })

    // validate stock & compute total
    let total = 0
    const orderItems = []
    for (const it of cart.items) {
      const product = it.product
      if (!product) return res.status(400).json({ error: 'Invalid product in cart' })
      if (product.stock < it.quantity) return res.status(400).json({ error: `Out of stock for ${product.name}` })
      total += product.price * it.quantity
      orderItems.push({ productId: product.id, name: product.name, quantity: it.quantity, price: product.price })
    }

    // Create Razorpay order if configured
    let razorOrder = null
    try {
      razorOrder = await RazorpayUtil.createOrder({ amount: Math.round(total * 100), currency: 'INR' })
    } catch (e) {
      // If Razorpay not configured, continue and return order without razorpay payload
      razorOrder = null
    }

    // Create order in DB
    const order = await prisma.order.create({ data: {
      customerId: userId,
      total,
      status: 'PENDING',
      payment: razorOrder ? { razorpayOrderId: razorOrder.id } : {},
      shippingAddress,
      items: { create: orderItems.map(oi => ({ productId: oi.productId, name: oi.name, quantity: oi.quantity, price: oi.price })) }
    }, include: { items: true } })

    // Reduce stock
    for (const it of cart.items) {
      await prisma.product.update({ where: { id: it.product.id }, data: { stock: { decrement: it.quantity } } })
    }

    // Clear cart
    await prisma.cartItem.deleteMany({ where: { cartId: cart.id } })

    res.status(201).json({ order, razorOrder })
  } catch (err) {
    next(err)
  }
}
