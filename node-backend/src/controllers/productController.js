const Product = require('../models/Product')

exports.list = async (req, res, next) => {
  try {
    const { search, category, sort } = req.query
    const filter = {}
    if (category && category !== 'All') filter.category = category
    if (search) filter.$or = [
      { name: new RegExp(search, 'i') },
      { description: new RegExp(search, 'i') }
    ]

    let query = Product.find(filter).limit(500)

    if (sort === 'price-low') query = query.sort({ price: 1 })
    else if (sort === 'price-high') query = query.sort({ price: -1 })
    else if (sort === 'name') query = query.sort({ name: 1 })
    else query = query.sort({ createdAt: -1 })

    const products = await query.exec()
    res.json(products)
  } catch (err) {
    next(err)
  }
}

exports.get = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id)
    if (!product) return res.status(404).json({ error: 'Not found' })
    res.json(product)
  } catch (err) {
    next(err)
  }
}

exports.create = async (req, res, next) => {
  try {
    const payload = req.body
    const existing = await Product.findOne({ slug: payload.slug })
    if (existing) return res.status(400).json({ error: 'Slug already exists' })
    const product = new Product(payload)
    await product.save()
    res.status(201).json(product)
  } catch (err) {
    next(err)
  }
}

exports.update = async (req, res, next) => {
  try {
    const updated = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true })
    res.json(updated)
  } catch (err) {
    next(err)
  }
}

exports.remove = async (req, res, next) => {
  try {
    await Product.findByIdAndDelete(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
}
