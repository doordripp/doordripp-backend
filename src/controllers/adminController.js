const prisma = require('../config/prisma');

// ==================== DASHBOARD STATS ====================
exports.getDashboardStats = async (req, res, next) => {
  try {
    // Get counts
    const totalProducts = await prisma.product.count();
    const totalUsers = await prisma.user.count();
    const totalOrders = await prisma.order.count();
    
    // Get total sales
    const orders = await prisma.order.findMany({
      select: { total: true }
    });
    const totalSales = orders.reduce((sum, order) => sum + order.total, 0);

    // Get recent orders for growth calculation (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const recentOrders = await prisma.order.count({
      where: {
        createdAt: { gte: thirtyDaysAgo }
      }
    });

    // Get order status breakdown
    const ordersByStatus = await prisma.order.groupBy({
      by: ['status'],
      _count: true
    });

    res.json({
      totalSales,
      totalOrders,
      totalProducts,
      totalCustomers: totalUsers,
      recentOrdersCount: recentOrders,
      salesGrowth: '+12.5%', // Would calculate from historical data
      ordersGrowth: '+8.2%',
      customersGrowth: '+5.1%',
      productsGrowth: '+3.4%',
      ordersByStatus: ordersByStatus.reduce((acc, item) => {
        acc[item.status] = item._count;
        return acc;
      }, {})
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
    
    const where = {};
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { description: { contains: search } }
      ];
    }
    if (category && category !== 'All') {
      where.category = category;
    }

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' }
      }),
      prisma.product.count({ where })
    ]);

    // Parse images JSON string to array
    const formattedProducts = products.map(p => ({
      ...p,
      images: p.images ? JSON.parse(p.images) : [],
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
    const product = await prisma.product.findUnique({
      where: { id: req.params.id }
    });
    if (!product) return res.status(404).json({ error: 'Product not found' });
    
    res.json({
      ...product,
      images: product.images ? JSON.parse(product.images) : []
    });
  } catch (err) {
    next(err);
  }
};

exports.createProduct = async (req, res, next) => {
  try {
    const { name, description, price, stock, category, images } = req.body;
    
    // Generate slug from name
    const slug = name.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') + 
      '-' + Date.now().toString(36);

    // Check if slug exists
    const existing = await prisma.product.findUnique({ where: { slug } });
    if (existing) {
      return res.status(400).json({ error: 'Product with similar name already exists' });
    }

    const product = await prisma.product.create({
      data: {
        name,
        slug,
        description: description || '',
        price: parseFloat(price),
        stock: parseInt(stock) || 0,
        category: category || 'Uncategorized',
        images: JSON.stringify(images || [])
      }
    });

    res.status(201).json({
      ...product,
      images: images || [],
      status: product.stock > 0 ? 'Active' : 'Out of Stock'
    });
  } catch (err) {
    next(err);
  }
};

exports.updateProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, description, price, stock, category, images } = req.body;

    // Check if product exists
    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (price !== undefined) updateData.price = parseFloat(price);
    if (stock !== undefined) updateData.stock = parseInt(stock);
    if (category !== undefined) updateData.category = category;
    if (images !== undefined) updateData.images = JSON.stringify(images);

    const product = await prisma.product.update({
      where: { id },
      data: updateData
    });

    res.json({
      ...product,
      images: product.images ? JSON.parse(product.images) : [],
      status: product.stock > 0 ? 'Active' : 'Out of Stock'
    });
  } catch (err) {
    next(err);
  }
};

exports.deleteProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    // Check if product exists
    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Delete related cart items first
    await prisma.cartItem.deleteMany({ where: { productId: id } });
    
    // Delete product
    await prisma.product.delete({ where: { id } });

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
    
    const where = {};
    if (status && status !== 'all') {
      where.status = status;
    }

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          customer: {
            select: { id: true, name: true, email: true }
          },
          items: {
            include: {
              product: {
                select: { name: true, images: true }
              }
            }
          }
        }
      }),
      prisma.order.count({ where })
    ]);

    const formattedOrders = orders.map(order => ({
      id: order.id,
      customer: order.customer?.name || 'Unknown',
      customerEmail: order.customer?.email || '',
      items: order.items.map(item => ({
        name: item.name,
        quantity: item.quantity,
        price: item.price,
        productImage: item.product?.images ? JSON.parse(item.product.images)[0] : null
      })),
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
    next(err);
  }
};

exports.getOrder = async (req, res, next) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: {
        customer: {
          select: { id: true, name: true, email: true }
        },
        items: {
          include: {
            product: true
          }
        }
      }
    });
    
    if (!order) return res.status(404).json({ error: 'Order not found' });

    res.json({
      ...order,
      customer: order.customer?.name || 'Unknown',
      customerEmail: order.customer?.email || ''
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

    const order = await prisma.order.update({
      where: { id },
      data: { status }
    });

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
    
    const where = {};
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { email: { contains: search } }
      ];
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          email: true,
          roles: true,
          blocked: true,
          createdAt: true,
          _count: {
            select: { orders: true }
          }
        }
      }),
      prisma.user.count({ where })
    ]);

    const formattedUsers = users.map(user => ({
      ...user,
      roles: user.roles ? JSON.parse(user.roles) : [],
      ordersCount: user._count.orders
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
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        name: true,
        email: true,
        roles: true,
        blocked: true,
        createdAt: true,
        orders: {
          orderBy: { createdAt: 'desc' },
          take: 10
        }
      }
    });
    
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({
      ...user,
      roles: user.roles ? JSON.parse(user.roles) : []
    });
  } catch (err) {
    next(err);
  }
};

// ==================== REPORTS ====================
exports.getBestSellers = async (req, res, next) => {
  try {
    const { days = 30 } = req.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    // Get order items grouped by product
    const orderItems = await prisma.orderItem.groupBy({
      by: ['productId'],
      _sum: {
        quantity: true,
        price: true
      },
      orderBy: {
        _sum: {
          quantity: 'desc'
        }
      },
      take: 10
    });

    // Get product details
    const productIds = orderItems.map(item => item.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } }
    });

    const productMap = products.reduce((acc, p) => {
      acc[p.id] = p;
      return acc;
    }, {});

    const bestSellers = orderItems.map(item => ({
      productId: item.productId,
      name: productMap[item.productId]?.name || 'Unknown Product',
      sales: item._sum.quantity || 0,
      revenue: (item._sum.price || 0) * (item._sum.quantity || 1)
    }));

    res.json(bestSellers);
  } catch (err) {
    next(err);
  }
};
