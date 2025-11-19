const prisma = require('../config/prisma');

exports.list = async (req, res, next) => {
  try {
    const { search, category, sort } = req.query;
    const where = {};
    if (category && category !== 'All') where.category = category;
    if (search) where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } }
    ];

    const orderBy = (sort === 'price-low') ? { price: 'asc' }
      : (sort === 'price-high') ? { price: 'desc' }
      : (sort === 'name') ? { name: 'asc' }
      : { createdAt: 'desc' };

    const products = await prisma.product.findMany({ where, orderBy, take: 500 });
    res.json(products);
  } catch (err) {
    next(err);
  }
};

exports.get = async (req, res, next) => {
  try {
    const product = await prisma.product.findUnique({ where: { id: req.params.id } });
    if (!product) return res.status(404).json({ error: 'Not found' });
    res.json(product);
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    const payload = req.body;
    const existing = await prisma.product.findFirst({ where: { slug: payload.slug } });
    if (existing) return res.status(400).json({ error: 'Slug already exists' });
    const product = await prisma.product.create({ data: payload });
    res.status(201).json(product);
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const updated = await prisma.product.update({ where: { id: req.params.id }, data: req.body });
    res.json(updated);
  } catch (err) {
    next(err);
  }
};

exports.remove = async (req, res, next) => {
  try {
    await prisma.product.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};
