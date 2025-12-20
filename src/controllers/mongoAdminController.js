const User = require('../models/User');
const Product = require('../models/Product');
const Order = require('../models/Order');

// ==================== DASHBOARD STATS ====================
exports.getDashboardStats = async (req, res, next) => {
  try {
    const [totalProducts, totalUsers, totalOrders, orders] = await Promise.all([
      Product.countDocuments(),
      User.countDocuments(),
      Order.countDocuments(),
      Order.find({}, 'total status createdAt')
    ]);

    const totalSales = orders.reduce((sum, order) => sum + (order.total || 0), 0);

    // Orders by status
    const ordersByStatus = orders.reduce((acc, order) => {
      acc[order.status] = (acc[order.status] || 0) + 1;
      return acc;
    }, {});

    // Recent orders (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recentOrdersCount = orders.filter(o => new Date(o.createdAt) >= thirtyDaysAgo).length;

    res.json({
      totalSales,
      totalOrders,
      totalProducts,
      totalCustomers: totalUsers,
      recentOrdersCount,
      salesGrowth: '+12.5%',
      ordersGrowth: '+8.2%',
      customersGrowth: '+5.1%',
      productsGrowth: '+3.4%',
      ordersByStatus
    });
  } catch (err) {
    next(err);
  }
};

// ==================== PRODUCTS ====================
exports.listProducts = async (req, res, next) => {
  try {
    const { search, category, page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const filter = {};
    if (search) {
      filter.$or = [
        { name: new RegExp(search, 'i') },
        { description: new RegExp(search, 'i') }
      ];
    }
    if (category && category !== 'All') {
      filter.category = category;
    }

    const [products, total] = await Promise.all([
      Product.find(filter).skip(skip).limit(parseInt(limit)).sort({ createdAt: -1 }),
      Product.countDocuments(filter)
    ]);

    const formattedProducts = products.map(p => ({
      id: p._id,
      _id: p._id,
      name: p.name,
      slug: p.slug,
      description: p.description,
      price: p.price,
      originalPrice: p.originalPrice,
      discount: p.discount,
      stock: p.stock,
      category: p.category,
      subcategory: p.subcategory,
      images: p.images || [],
      colors: p.colors || [],
      sizes: p.sizes || [],
      rating: p.rating || { rating: 4.5, reviews: 0 },
      isNewArrival: p.isNewArrival || false,
      isBestSeller: p.isBestSeller || false,
      isFeatured: p.isFeatured || false,
      status: p.stock > 0 ? 'Active' : 'Out of Stock'
    }));

    res.json({
      products: formattedProducts,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit))
    });
  } catch (err) {
    next(err);
  }
};

exports.getProduct = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    res.json({
      id: product._id,
      _id: product._id,
      name: product.name,
      slug: product.slug,
      description: product.description,
      price: product.price,
      originalPrice: product.originalPrice,
      discount: product.discount,
      stock: product.stock,
      category: product.category,
      subcategory: product.subcategory,
      images: product.images || [],
      colors: product.colors || [],
      sizes: product.sizes || [],
      rating: product.rating || { rating: 4.5, reviews: 0 },
      isNewArrival: product.isNewArrival || false,
      isBestSeller: product.isBestSeller || false,
      isFeatured: product.isFeatured || false
    });
  } catch (err) {
    next(err);
  }
};

exports.createProduct = async (req, res, next) => {
  try {
    const { 
      name, 
      description, 
      price, 
      originalPrice,
      discount,
      stock, 
      category, 
      subcategory,
      images,
      colors,
      sizes,
      rating,
      isNewArrival,
      isBestSeller,
      isFeatured
    } = req.body;

    // Generate slug
    const slug = name.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') +
      '-' + Date.now().toString(36);

    const product = new Product({
      name,
      slug,
      description: description || '',
      price: parseFloat(price),
      originalPrice: originalPrice ? parseFloat(originalPrice) : undefined,
      discount: discount ? parseFloat(discount) : undefined,
      stock: parseInt(stock) || 0,
      category: category || 'Uncategorized',
      subcategory: subcategory || '',
      images: images || [],
      colors: colors || [],
      sizes: sizes || [],
      rating: rating || { rating: 4.5, reviews: 0 },
      isNewArrival: isNewArrival || false,
      isBestSeller: isBestSeller || false,
      isFeatured: isFeatured || false
    });

    await product.save();

    res.status(201).json({
      id: product._id,
      _id: product._id,
      name: product.name,
      slug: product.slug,
      description: product.description,
      price: product.price,
      originalPrice: product.originalPrice,
      discount: product.discount,
      stock: product.stock,
      category: product.category,
      subcategory: product.subcategory,
      images: product.images,
      colors: product.colors,
      sizes: product.sizes,
      rating: product.rating,
      isNewArrival: product.isNewArrival,
      isBestSeller: product.isBestSeller,
      isFeatured: product.isFeatured,
      status: product.stock > 0 ? 'Active' : 'Out of Stock'
    });
  } catch (err) {
    next(err);
  }
};

exports.updateProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { 
      name, 
      description, 
      price, 
      originalPrice,
      discount,
      stock, 
      category,
      subcategory, 
      images,
      colors,
      sizes,
      rating,
      isNewArrival,
      isBestSeller,
      isFeatured
    } = req.body;

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (price !== undefined) updateData.price = parseFloat(price);
    if (originalPrice !== undefined) updateData.originalPrice = parseFloat(originalPrice);
    if (discount !== undefined) updateData.discount = parseFloat(discount);
    if (stock !== undefined) updateData.stock = parseInt(stock);
    if (category !== undefined) updateData.category = category;
    if (subcategory !== undefined) updateData.subcategory = subcategory;
    if (images !== undefined) updateData.images = images;
    if (colors !== undefined) updateData.colors = colors;
    if (sizes !== undefined) updateData.sizes = sizes;
    if (rating !== undefined) updateData.rating = rating;
    if (isNewArrival !== undefined) updateData.isNewArrival = isNewArrival;
    if (isBestSeller !== undefined) updateData.isBestSeller = isBestSeller;
    if (isFeatured !== undefined) updateData.isFeatured = isFeatured;

    const product = await Product.findByIdAndUpdate(id, updateData, { new: true });
    if (!product) return res.status(404).json({ error: 'Product not found' });

    res.json({
      id: product._id,
      _id: product._id,
      name: product.name,
      slug: product.slug,
      description: product.description,
      price: product.price,
      originalPrice: product.originalPrice,
      discount: product.discount,
      stock: product.stock,
      category: product.category,
      subcategory: product.subcategory,
      images: product.images,
      colors: product.colors,
      sizes: product.sizes,
      rating: product.rating,
      isNewArrival: product.isNewArrival,
      isBestSeller: product.isBestSeller,
      isFeatured: product.isFeatured,
      status: product.stock > 0 ? 'Active' : 'Out of Stock'
    });
  } catch (err) {
    next(err);
  }
};

exports.deleteProduct = async (req, res, next) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json({ ok: true, message: 'Product deleted successfully' });
  } catch (err) {
    next(err);
  }
};

// ==================== ORDERS ====================
exports.listOrders = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const filter = {};
    if (status && status !== 'all') {
      filter.status = status;
    }

    const [orders, total] = await Promise.all([
      Order.find(filter)
        .populate('customer', 'name email')
        .skip(skip)
        .limit(parseInt(limit))
        .sort({ createdAt: -1 }),
      Order.countDocuments(filter)
    ]);

    console.log(`📦 Admin fetching orders: ${orders.length} found, ${total} total in DB`);

    const formattedOrders = orders.map(order => ({
      id: order._id,
      _id: order._id,
      customer: order.customer?.name || 'Unknown',
      customerEmail: order.customer?.email || '',
      items: order.items,
      total: order.total,
      status: order.status,
      shippingAddress: order.shippingAddress,
      payment: order.payment,
      date: order.createdAt
    }));

    res.json({
      orders: formattedOrders,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit))
    });
  } catch (err) {
    console.error('❌ Error fetching orders:', err);
    next(err);
  }
};

exports.getOrder = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id).populate('customer', 'name email');
    if (!order) return res.status(404).json({ error: 'Order not found' });

    res.json({
      id: order._id,
      _id: order._id,
      customer: order.customer?.name || 'Unknown',
      customerEmail: order.customer?.email || '',
      items: order.items,
      total: order.total,
      status: order.status,
      shippingAddress: order.shippingAddress,
      payment: order.payment,
      date: order.createdAt
    });
  } catch (err) {
    next(err);
  }
};

exports.updateOrderStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const order = await Order.findByIdAndUpdate(id, { status }, { new: true });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    res.json({ ok: true, order });
  } catch (err) {
    next(err);
  }
};

// ==================== USERS ====================
exports.listUsers = async (req, res, next) => {
  try {
    const { search, page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const filter = {};
    if (search) {
      filter.$or = [
        { name: new RegExp(search, 'i') },
        { email: new RegExp(search, 'i') }
      ];
    }

    const [users, total] = await Promise.all([
      User.find(filter, '-password -refreshToken')
        .skip(skip)
        .limit(parseInt(limit))
        .sort({ createdAt: -1 }),
      User.countDocuments(filter)
    ]);

    // Get order counts for each user
    const userIds = users.map(u => u._id);
    const orderCounts = await Order.aggregate([
      { $match: { customer: { $in: userIds } } },
      { $group: { _id: '$customer', count: { $sum: 1 } } }
    ]);
    const orderCountMap = orderCounts.reduce((acc, item) => {
      acc[item._id.toString()] = item.count;
      return acc;
    }, {});

    const formattedUsers = users.map(user => ({
      id: user._id,
      _id: user._id,
      name: user.name,
      email: user.email,
      roles: user.roles || [],
      blocked: user.blocked,
      createdAt: user.createdAt,
      ordersCount: orderCountMap[user._id.toString()] || 0
    }));

    res.json({
      users: formattedUsers,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit))
    });
  } catch (err) {
    next(err);
  }
};

exports.getUser = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id, '-password -refreshToken');
    if (!user) return res.status(404).json({ error: 'User not found' });

    const orders = await Order.find({ customer: user._id })
      .sort({ createdAt: -1 })
      .limit(10);

    res.json({
      id: user._id,
      _id: user._id,
      name: user.name,
      email: user.email,
      roles: user.roles || [],
      blocked: user.blocked,
      createdAt: user.createdAt,
      orders
    });
  } catch (err) {
    next(err);
  }
};

exports.updateUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, email, roles, blocked } = req.body;

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (email !== undefined) updateData.email = email;
    if (roles !== undefined) updateData.roles = roles;
    if (blocked !== undefined) updateData.blocked = blocked;

    const user = await User.findByIdAndUpdate(id, updateData, { new: true }).select('-password -refreshToken');
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({
      id: user._id,
      _id: user._id,
      name: user.name,
      email: user.email,
      roles: user.roles || [],
      blocked: user.blocked,
      createdAt: user.createdAt
    });
  } catch (err) {
    next(err);
  }
};

exports.deleteUser = async (req, res, next) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true, message: 'User deleted successfully' });
  } catch (err) {
    next(err);
  }
};

// ==================== REPORTS ====================
exports.getBestSellers = async (req, res, next) => {
  try {
    const bestSellers = await Order.aggregate([
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.name',
          sales: { $sum: '$items.quantity' },
          revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } }
        }
      },
      { $sort: { sales: -1 } },
      { $limit: 10 },
      {
        $project: {
          name: '$_id',
          sales: 1,
          revenue: 1,
          _id: 0
        }
      }
    ]);

    res.json(bestSellers);
  } catch (err) {
    next(err);
  }
};
