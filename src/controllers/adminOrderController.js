const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const User = require('../models/User');
const Product = require('../models/Product');
const Order = require('../models/Order');
const AreaManager = require('../models/AreaManager');
const { hasAnyRole } = require('../middleware/auth');
const { getOrderTrackUrl } = require('../utils/appUrls');
const { buildProductInventoryPayload, normalizeSizeInventory } = require('../utils/productInventory');

const CURRENT_DELIVERY_ORDER_STATUSES = ['confirmed', 'accepted', 'picked_up', 'out_for_delivery'];
const STATUS_TO_DELIVERY_STATUS = {
  confirmed: 'confirmed',
  accepted: 'accepted',
  picked_up: 'picked_up',
  out_for_delivery: 'out_for_delivery',
  delivered: 'delivered',
  failed: 'failed',
  cancelled: 'cancelled'
};

const forwardAdminError = (next, res, err, fallbackMessage = 'Internal server error') => {
  if (typeof next === 'function') {
    return next(err);
  }

  logger.error('Admin controller fallback error:', err);
  if (res && !res.headersSent) {
    return res.status(err?.status || 500).json({
      error: err?.message || fallbackMessage
    });
  }

  return null;
};

const normalizeProductDetails = (details) => {
  if (!details) return {};
  if (details instanceof Map) return Object.fromEntries(details);
  if (typeof details.toObject === 'function') return details.toObject();
  return details;
};

const normalizeProductKeyFeatures = (keyFeatures) => {
  if (!keyFeatures) return [];
  if (Array.isArray(keyFeatures)) return keyFeatures;
  if (typeof keyFeatures === 'string') {
    try {
      const parsed = JSON.parse(keyFeatures);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return keyFeatures
        .split('\n')
        .map(feature => feature.trim())
        .filter(Boolean);
    }
  }
  return [];
};

const formatProductResponse = (product, extra = {}) => {
  const inventory = buildProductInventoryPayload(product);

  return {
    id: product._id,
    _id: product._id,
    name: product.name,
    slug: product.slug,
    description: product.description,
    price: product.price,
    originalPrice: product.originalPrice,
    discount: product.discount,
    costPrice: product.costPrice,
    deliveryCost: product.deliveryCost,
    pricingMode: product.pricingMode,
    gstRate: product.gstRate,
    stock: inventory.stock,
    category: product.category,
    subcategory: product.subcategory,
    dressStyle: product.dressStyle,
    images: product.images || [],
    colors: product.colors || [],
    sizes: inventory.sizes,
    sizeInventory: inventory.sizeInventory,
    availableSizes: inventory.availableSizes,
    defaultSize: inventory.defaultSize,
    rating: product.rating || { rating: 4.5, reviews: 0 },
    isNewArrival: product.isNewArrival || false,
    isBestSeller: product.isBestSeller || false,
    isFeatured: product.isFeatured || false,
    productSource: product.productSource || 'Manufacturer',
    listedBy: toListedByPayload(product.listedBy),
    details: normalizeProductDetails(product.details),
    keyFeatures: normalizeProductKeyFeatures(product.keyFeatures),
    status: inventory.inStock ? 'Active' : 'Out of Stock',
    ...extra
  };
};

const normalizeProductImages = (images) => {
  if (!Array.isArray(images)) return [];
  return images
    .filter(image => typeof image === 'string')
    .map(image => image.trim())
    .filter(Boolean);
};

const toListedByPayload = (listedBy) => {
  if (!listedBy) return null;

  if (typeof listedBy === 'object' && listedBy.name) {
    return {
      id: listedBy._id || listedBy.id,
      name: listedBy.name,
      email: listedBy.email || ''
    };
  }

  return {
    id: listedBy,
    name: '',
    email: ''
  };
};

const parseCoordinate = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = parseFloat(value);
  return Number.isNaN(parsed) ? null : parsed;
};

const isOrderInAnyAssignedZone = (order, assignedZones) => {
  const lat = parseCoordinate(order?.shippingAddress?.latitude);
  const lng = parseCoordinate(order?.shippingAddress?.longitude);

  if (lat === null || lng === null || !Array.isArray(assignedZones) || assignedZones.length === 0) {
    return false;
  }

  return assignedZones.some(zone => {
    if (!zone || !zone.isActive || typeof zone.containsPoint !== 'function') return false;
    return zone.containsPoint(lat, lng);
  });
};

const getAssignedZonesForDeliveryUser = async (userId) => {
  const [assignments, user] = await Promise.all([
    AreaManager.find({
      manager: userId,
      status: 'active'
    }).populate('deliveryZone'),
    User.findById(userId)
      .select('deliveryPartner.assignedArea')
      .populate('deliveryPartner.assignedArea')
  ]);

  const zones = assignments
    .map(assignment => assignment.deliveryZone)
    .filter(Boolean)
    .filter(zone => zone.isActive);

  if (user?.deliveryPartner?.assignedArea?.isActive) {
    zones.push(user.deliveryPartner.assignedArea);
  }

  return zones.filter((zone, index, list) => (
    list.findIndex(candidate => String(candidate?._id) === String(zone?._id)) === index
  ));
};

const buildDeliveryPartnerSnapshot = (partner) => ({
  id: partner._id,
  riderId: partner._id,
  name: partner.name || partner.email,
  phone: partner.phone || partner.phoneNumber || '',
  photo: partner.profileImage || partner.profilePhoto || partner.avatar || '',
  rating: partner.rating || 4.8,
  vehicleType: partner.deliveryPartner?.vehicleType || partner.vehicleType || 'Bike'
});

const adjustDeliveryPartnerLoad = async (partnerId, delta) => {
  if (!partnerId || !delta) return;

  const partner = await User.findById(partnerId);
  if (!partner?.deliveryPartner) return;

  const currentLoad = Number(partner.deliveryPartner.currentLoad || 0);
  partner.deliveryPartner.currentLoad = Math.max(0, currentLoad + delta);
  await partner.save();
};

const isAssignedToPartner = (order, userId) => {
  const me = String(userId);
  const assigned = order?.assignedDeliveryPartner ? String(order.assignedDeliveryPartner) : null;
  const dpId = order?.deliveryPartner?.id ? String(order.deliveryPartner.id) : null;
  const legacyDpId = order?.deliveryPartner?.riderId ? String(order.deliveryPartner.riderId) : null;
  return assigned === me || dpId === me || legacyDpId === me;
};

const hasAnyAssignedPartner = (order) => {
  return Boolean(order?.assignedDeliveryPartner || order?.deliveryPartner?.id || order?.deliveryPartner?.riderId);
};

const MANAGEABLE_ROLES = ['admin', 'manager', 'delivery_partner'];

const normalizeStoredRoles = (roles = []) => {
  const roleArray = Array.isArray(roles) ? roles : [roles];
  return Array.from(new Set(
    roleArray
      .filter(Boolean)
      .map(role => String(role).toLowerCase().trim())
      .filter(role => MANAGEABLE_ROLES.includes(role))
  ));
};

// ==================== DASHBOARD STATS ====================

exports.listOrders = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
    const wantsAllOrders = String(limit).toLowerCase() === 'all';
    const parsedLimit = wantsAllOrders ? null : Math.max(parseInt(limit, 10) || 50, 1);
    const skip = parsedLimit ? (parsedPage - 1) * parsedLimit : 0;
    const isAdmin = hasAnyRole(req.user?.roles, ['admin']);
    const isManager = hasAnyRole(req.user?.roles, ['manager']);
    const isDeliveryPartner = hasAnyRole(req.user?.roles, ['delivery_partner']);
    const isDeliveryOnly = !isAdmin && !isManager && isDeliveryPartner;

    if (!isAdmin && !isManager && !isDeliveryPartner) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    if (isDeliveryOnly) {
      const assignedZones = await getAssignedZonesForDeliveryUser(req.user.id);
      if (assignedZones.length === 0) {
        return res.json({
          orders: [],
          total: 0,
          page: parsedPage,
          totalPages: 0
        });
      }

      const filter = {
        status: status && status !== 'all' ? status : { $in: CURRENT_DELIVERY_ORDER_STATUSES }
      };

      const candidateOrders = await Order.find(filter)
        .populate('customer', 'name email')
        .populate('items.product', 'name images')
        .sort({ createdAt: -1 });

      const zoneFilteredOrders = candidateOrders.filter(order => {
        if (!isOrderInAnyAssignedZone(order, assignedZones)) return false;
        // Delivery partners can work on unassigned orders in their zone,
        // or orders already assigned to themselves.
        return !hasAnyAssignedPartner(order) || isAssignedToPartner(order, req.user.id);
      });
      const paginatedOrders = parsedLimit
        ? zoneFilteredOrders.slice(skip, skip + parsedLimit)
        : zoneFilteredOrders;

      const formattedOrders = paginatedOrders.map(order => ({
        id: order._id.toString(),
        _id: order._id.toString(),
        customer: order.customer?.name || 'Unknown',
        customerEmail: order.customer?.email || '',
        items: order.items,
        total: order.total,
        totalBeforeDiscount: order.totalBeforeDiscount || order.total,
        voucherDiscount: order.voucherDiscount || 0,
        voucher: order.voucher || null,
        status: order.status,
        assignedDeliveryPartner: order.assignedDeliveryPartner ? order.assignedDeliveryPartner.toString() : null,
        deliveryPartner: order.deliveryPartner || null,
        deliveryStatus: order.deliveryStatus,
        statusHistory: order.statusHistory || [],
        isTrial: order.isTrial || false,
        trialItems: order.trialItems || [],
        trialFee: order.trialFee || 0,
        deliveryFee: order.deliveryFee || 0,
        shippingAddress: order.shippingAddress,
        payment: order.payment,
        date: order.createdAt
      }));

      return res.json({
        orders: formattedOrders,
        total: zoneFilteredOrders.length,
        page: parsedPage,
        totalPages: parsedLimit ? Math.ceil(zoneFilteredOrders.length / parsedLimit) : (zoneFilteredOrders.length > 0 ? 1 : 0)
      });
    }

    const filter = {};
    if (status && status !== 'all') {
      filter.status = status;
    }

    const [orders, total] = await Promise.all([
      (() => {
        const query = Order.find(filter)
          .populate('customer', 'name email')
          .populate('items.product', 'name images')
          .sort({ createdAt: -1 });

        if (parsedLimit) {
          query.skip(skip).limit(parsedLimit);
        }

        return query;
      })(),
      Order.countDocuments(filter)
    ]);

    logger.info('Admin fetching orders: ' + orders.length + ' found, ' + total + ' total in DB');

    const formattedOrders = orders.map(order => ({
      id: order._id.toString(),
      _id: order._id.toString(),
      customer: order.customer?.name || 'Unknown',
      customerEmail: order.customer?.email || '',
      items: order.items,
      total: order.total,
      totalBeforeDiscount: order.totalBeforeDiscount || order.total,
      voucherDiscount: order.voucherDiscount || 0,
      voucher: order.voucher || null,
      status: order.status,
      assignedDeliveryPartner: order.assignedDeliveryPartner ? order.assignedDeliveryPartner.toString() : null,
      deliveryPartner: order.deliveryPartner || null,
      deliveryStatus: order.deliveryStatus,
      statusHistory: order.statusHistory || [],
      isTrial: order.isTrial || false,
      trialItems: order.trialItems || [],
      trialFee: order.trialFee || 0,
      deliveryFee: order.deliveryFee || 0,
      shippingAddress: order.shippingAddress,
      payment: order.payment,
      date: order.createdAt
    }));

    res.json({
      orders: formattedOrders,
      total,
      page: parsedPage,
      totalPages: parsedLimit ? Math.ceil(total / parsedLimit) : (total > 0 ? 1 : 0)
    });
  } catch (err) {
    logger.error('❌ Error fetching orders:', err);
    next(err);
  }
};


exports.getOrder = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('customer', 'name email')
      .populate('items.product', 'name images');
    if (!order) return res.status(404).json({ error: 'Order not found' });

  const isAdmin = hasAnyRole(req.user?.roles, ['admin']);
  const isManager = hasAnyRole(req.user?.roles, ['manager']);
  const isDeliveryPartner = hasAnyRole(req.user?.roles, ['delivery_partner']);

  // Only restrict delivery partners by zone/assignment; admins and managers can see any order
  if (!isAdmin && !isManager && isDeliveryPartner) {
      if (!CURRENT_DELIVERY_ORDER_STATUSES.includes(order.status)) {
        return res.status(403).json({ error: 'You can only access current orders' });
      }

      const assignedZones = await getAssignedZonesForDeliveryUser(req.user.id);
      const canAccessOrder = isOrderInAnyAssignedZone(order, assignedZones);

      if (!canAccessOrder) {
        return res.status(403).json({ error: 'Order is outside your assigned area' });
      }

      // If already assigned, only the assigned partner may manage/view it.
      if (hasAnyAssignedPartner(order) && !isAssignedToPartner(order, req.user.id)) {
        return res.status(403).json({ error: 'Order is assigned to another delivery partner' });
      }
    }

    res.json({
      id: order._id.toString(),
      _id: order._id.toString(),
      customer: order.customer?.name || 'Unknown',
      customerEmail: order.customer?.email || '',
      items: order.items,
      total: order.total,
      totalBeforeDiscount: order.totalBeforeDiscount || order.total,
      voucherDiscount: order.voucherDiscount || 0,
      voucher: order.voucher || null,
      status: order.status,
      assignedDeliveryPartner: order.assignedDeliveryPartner ? order.assignedDeliveryPartner.toString() : null,
      deliveryPartner: order.deliveryPartner || null,
      deliveryStatus: order.deliveryStatus,
      statusHistory: order.statusHistory || [],
      isTrial: order.isTrial || false,
      trialItems: order.trialItems || [],
      trialFee: order.trialFee || 0,
      deliveryFee: order.deliveryFee || 0,
      shippingAddress: order.shippingAddress,
      payment: order.payment,
      date: order.createdAt
    });
  } catch (err) {
    next(err);
  }
};


exports.getOrderBill = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id).populate('customer', 'name email phone').populate('items.product');
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // Check permissions
    const isAdmin = hasAnyRole(req.user?.roles, ['admin']);
    const isManager = hasAnyRole(req.user?.roles, ['manager']);
    
    if (!isAdmin && !isManager) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    // Generate bill HTML
    const billHtml = generateBillHTML(order);
    
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(billHtml);
  } catch (err) {
    next(err);
  }
};

// Helper function to format currency
function formatMoney(amount) {
  return parseFloat(amount || 0).toFixed(2);
}

let cachedBillLogoDataUri = null;

function getDoordrippBillLogoDataUri() {
  if (cachedBillLogoDataUri) {
    return cachedBillLogoDataUri;
  }

  try {
    const logoPath = path.join(__dirname, '../../../node-frontend/public/vite.svg');
    const svg = fs.readFileSync(logoPath, 'utf8');
    cachedBillLogoDataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    return cachedBillLogoDataUri;
  } catch (error) {
    logger.warn('Bill logo file not found, using fallback icon:', error.message);
    return null;
  }
}

// Helper function to generate bill HTML
function generateBillHTML(order) {
  const orderDate = new Date(order.createdAt);
  const dateStr = orderDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr = orderDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  
  const items = order.items || [];
  const subtotal = parseFloat(order.totalBeforeDiscount || order.total || 0);
  const discount = parseFloat(order.voucherDiscount || 0);
  const deliveryFee = parseFloat(order.deliveryFee || 0);
  const total = parseFloat(order.total || 0);
  const billLogoDataUri = getDoordrippBillLogoDataUri();
  const shippingAddress = order.shippingAddress || {};
  const customerPhone = order.customer?.phone || shippingAddress.phone || 'N/A';
  const fullAddress = [
    shippingAddress.line1,
    shippingAddress.line2,
    shippingAddress.street,
    shippingAddress.city,
    shippingAddress.state,
    shippingAddress.pincode || shippingAddress.zip
  ]
    .filter(Boolean)
    .join(', ') || 'N/A';
  
  // Generate order ID in format like #DRP10247
  const orderId = '#DRP' + order._id.toString().slice(-5).toUpperCase();
  
  // Format items for receipt
  const itemsReceipt = items.map(item => {
    const itemTotal = parseFloat(item.price * item.quantity);
    return `${item.name || item.product?.name || 'Product'} ${' '.repeat(40 - (item.name || item.product?.name || 'Product').length)} ${item.quantity} ₹${formatMoney(item.price)} ₹${formatMoney(itemTotal)}`;
  }).join('\n');

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Order Bill - DoorDripp</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        @page {
          size: 50mm auto;
          margin: 0;
        }
        body {
          font-family: 'Courier New', monospace;
          line-height: 1.3;
          color: #000;
          background: #f0f0f0;
          padding: 2mm;
          display: flex;
          justify-content: center;
        }
        .receipt {
          width: 50mm;
          max-width: 50mm;
          margin: 0 auto;
          background: white;
          padding: 2mm;
          border: 0.25mm solid #000;
          position: relative;
          box-shadow: 0 1mm 2mm rgba(0,0,0,0.2);
          overflow: hidden;
        }
        .receipt::before,
        .receipt::after {
          content: '';
          position: absolute;
          left: -2mm;
          right: -2mm;
          height: 2mm;
          background: repeating-linear-gradient(45deg, transparent, transparent 2mm, #ddd 2mm, #ddd 4mm);
        }
        .receipt::before {
          top: -2mm;
        }
        .receipt::after {
          bottom: -2mm;
        }
        .center { text-align: center; }
        .logo-box {
          text-align: center;
          margin-bottom: 2mm;
          font-size: 2.7mm;
          font-weight: bold;
          letter-spacing: 0.25mm;
        }
        .brand-logo {
          display: block;
          width: 16mm;
          max-width: 60%;
          height: auto;
          object-fit: contain;
          margin: 0 auto 1mm auto;
        }
        .logo-text {
          font-size: 4.2mm;
          font-weight: bold;
          margin: 1mm 0;
          letter-spacing: 0.15mm;
        }
        .tagline {
          font-size: 2.4mm;
          font-weight: bold;
          font-style: italic;
          margin: 0.5mm 0;
          letter-spacing: 0.1mm;
        }
        .categories {
          font-size: 2.1mm;
          font-weight: bold;
          margin: 0.5mm 0 1.5mm 0;
          letter-spacing: 0.05mm;
        }
        .separator {
          border-top: 0.2mm dashed #000;
          margin: 1.5mm 0;
        }
        .bill-title {
          font-size: 2.6mm;
          font-weight: bold;
          letter-spacing: 0.1mm;
          margin: 1.5mm 0;
        }
        .info-row {
          display: flex;
          justify-content: space-between;
          font-size: 2.3mm;
          margin: 0.6mm 0;
          gap: 1mm;
          flex-wrap: wrap;
        }
        .label { font-weight: bold; }
        .value { text-align: right; max-width: 58%; word-break: break-word; }
        .status-badge {
          display: inline-block;
          background: #000;
          color: white;
          padding: 0.5mm 1.5mm;
          font-size: 2mm;
          font-weight: bold;
          border-radius: 0.5mm;
        }
        .customer-section {
          font-size: 2.3mm;
          margin: 1mm 0;
          line-height: 1.35;
          word-break: break-word;
        }
        .table-header {
          display: grid;
          grid-template-columns: 1.5fr 1fr 1fr 1fr;
          gap: 0.6mm;
          font-size: 2.1mm;
          font-weight: bold;
          background: #000;
          color: white;
          padding: 0.8mm;
          margin: 1mm 0;
        }
        .table-row {
          display: grid;
          grid-template-columns: 1.5fr 1fr 1fr 1fr;
          gap: 0.6mm;
          font-size: 2.1mm;
          padding: 0.6mm 0;
          border-bottom: 0.2mm solid #eee;
        }
        .table-row .col {
          word-break: break-word;
          overflow-wrap: break-word;
        }
        .promo-box {
          border: 0.25mm solid #000;
          padding: 1.2mm;
          margin: 1.5mm 0;
          text-align: center;
          font-size: 2.2mm;
          font-weight: bold;
        }
        .promo-icon {
          font-size: 2.5mm;
          margin: 0 0.8mm;
        }
        .footer-msg {
          text-align: center;
          font-size: 2.4mm;
          font-weight: bold;
          margin: 1.5mm 0;
          line-height: 1.35;
        }
        .footer-tagline {
          text-align: center;
          font-size: 2mm;
          margin: 1.5mm 0;
          font-weight: bold;
          letter-spacing: 0.08mm;
        }
        .summary-line {
          display: flex;
          justify-content: space-between;
          font-size: 2.2mm;
          margin: 0.5mm 0;
        }
        .total-line {
          display: flex;
          justify-content: space-between;
          font-size: 3.2mm;
          font-weight: bold;
          margin: 1mm 0;
          padding: 0.6mm 0;
        }
        @media print {
          body { background: white; padding: 0; margin: 0; display: block; }
          .receipt { box-shadow: none; border-radius: 0; margin: 0; width: 50mm; max-width: 50mm; }
          .receipt::before, .receipt::after { background: none; }
        }
      </style>
    </head>
    <body>
      <div class="receipt">
        <!-- Logo & Branding -->
        <div class="logo-box">
          ${billLogoDataUri ? `<img src="${billLogoDataUri}" alt="DoorDripp Logo" class="brand-logo" />` : `<div style="font-size: 3.5mm; margin-bottom: 1mm;">DD</div>`}
          <div class="logo-text">DOORDRIPP</div>
          <div class="tagline">FAST DELIVERY</div>
          <div class="categories">Clothes, Accessories, Footwear</div>
        </div>
        
        <div class="separator"></div>
        
        <!-- Bill Title -->
        <div class="center bill-title">BILL / INVOICE</div>
        
        <!-- Order Info -->
        <div class="info-row">
          <span class="label">Order ID :</span>
          <span class="value">${orderId}</span>
        </div>
        <div class="info-row">
          <span class="label">Date</span>
          <span class="value">${dateStr}</span>
          <span class="label" style="margin-left: 15px;">Time:</span>
          <span class="value">${timeStr}</span>
        </div>
        <div class="info-row">
          <span class="label">Type</span>
          <span class="value">Delivery</span>
          <span style="margin-left: auto;"><span class="status-badge">PAID</span></span>
        </div>
        
        <div class="separator"></div>
        
        <!-- Customer Info -->
        <div class="customer-section">
          <div><strong>Customer:</strong> ${order.customer?.name || 'Customer'}</div>
          <div><strong>Phone</strong>: ${customerPhone}</div>
          <div><strong>Address</strong>: ${fullAddress}</div>
        </div>
        
        <div class="separator"></div>
        
        <!-- Items Table -->
        <div class="table-header">
          <span>ITEM</span>
          <span>QTY</span>
          <span>PRICE</span>
          <span>AMT</span>
        </div>
        ${items.map((item, idx) => {
          const itemTotal = parseFloat(item.price * item.quantity);
          return `
            <div class="table-row">
              <span class="col">${item.name || item.product?.name || 'Product'}</span>
              <span class="col">${item.quantity}</span>
              <span class="col">₹${formatMoney(item.price)}</span>
              <span class="col">₹${formatMoney(itemTotal)}</span>
            </div>
          `;
        }).join('')}
        
        <div class="separator"></div>
        
        <!-- Summary -->
        <div class="summary-line">
          <span class="label">SubTotal:</span>
          <span>₹${formatMoney(subtotal)}</span>
        </div>
        ${deliveryFee > 0 ? `
          <div class="summary-line">
            <span class="label">Delivery Fee</span>
            <span>₹${formatMoney(deliveryFee)}</span>
          </div>
        ` : ''}
        ${discount > 0 ? `
          <div class="summary-line">
            <span class="label">Discount</span>
            <span>-₹${formatMoney(discount)}</span>
          </div>
        ` : ''}
        
        <div class="separator"></div>
        
        <!-- Total -->
        <div class="total-line">
          <span>TOTAL</span>
          <span>₹${formatMoney(total)}</span>
        </div>
        
        <div class="separator"></div>
        
        <!-- Payment & Delivery Info -->
        <div class="info-row" style="font-size: 10px; margin: 5px 0;">
          <span class="label">Payment Method:</span>
          <span class="value">${order.payment?.method?.toUpperCase() || 'COD'}</span>
        </div>
        ${order.assignedDeliveryPartner ? `
          <div class="info-row" style="font-size: 10px; margin: 5px 0;">
            <span class="label">Rider</span>
            <span class="value"><strong>Assigned</strong></span>
          </div>
        ` : ''}
        
        <div class="separator"></div>
        
        <!-- Promo Box -->
        <div class="promo-box">
          <span class="promo-icon">🎁</span>
          Free Delivery on orders above ₹499
          <span class="promo-icon">🎁</span>
        </div>
        
        <!-- Thank You Message -->
        <div class="footer-msg">
          ⚠️ THANK YOU FOR ORDERING! ⚠️<br>
          your Dripp will arive soon.
        </div>
        
        <!-- Footer -->
        <div class="footer-tagline">
          — DOORDRIPP —
        </div>
      </div>
    </body>
    </html>
  `;
}


exports.updateOrderStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, note } = req.body;
    const isAdmin = hasAnyRole(req.user?.roles, ['admin']);
    const isManager = hasAnyRole(req.user?.roles, ['manager']);
    const isAdminOrManager = isAdmin || isManager;
    const isDeliveryPartner = hasAnyRole(req.user?.roles, ['delivery_partner']);
    const isDeliveryOnly = !isAdminOrManager && isDeliveryPartner;

    if (!isAdminOrManager && !isDeliveryPartner) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const validStatuses = isAdminOrManager
      ? ['confirmed', 'accepted', 'picked_up', 'out_for_delivery', 'delivered', 'failed', 'cancelled']
      : ['accepted', 'picked_up', 'out_for_delivery', 'delivered'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const existingOrder = await Order.findById(id);
    if (!existingOrder) return res.status(404).json({ error: 'Order not found' });

    if (isDeliveryOnly) {
      const assignedZones = await getAssignedZonesForDeliveryUser(req.user.id);
      const canAccessOrder = isOrderInAnyAssignedZone(existingOrder, assignedZones);

      if (!canAccessOrder) {
        return res.status(403).json({ error: 'Order is outside your assigned area' });
      }

      if (!CURRENT_DELIVERY_ORDER_STATUSES.includes(existingOrder.status) && existingOrder.status !== 'delivered') {
        return res.status(400).json({ error: `Cannot update order with status: ${existingOrder.status}` });
      }
    }

    const previousStatus = existingOrder.status;
    const assignedPartnerId = existingOrder.assignedDeliveryPartner || existingOrder.deliveryPartner?.id || existingOrder.deliveryPartner?.riderId;

    existingOrder.status = status;
    if (STATUS_TO_DELIVERY_STATUS[status]) {
      existingOrder.deliveryStatus = STATUS_TO_DELIVERY_STATUS[status];
    }
    existingOrder.deliveryUpdates = existingOrder.deliveryUpdates || [];
    existingOrder.deliveryUpdates.push({
      status,
      note: typeof note === 'string' ? note.trim() : undefined,
      updatedBy: req.user.id,
      updatedByRole: isAdminOrManager ? (isAdmin ? 'admin' : 'manager') : 'delivery_partner',
      updatedAt: new Date()
    });
    existingOrder.statusHistory = existingOrder.statusHistory || [];
    existingOrder.statusHistory.push({
      status,
      timestamp: new Date(),
      updatedBy: req.user.id,
      updatedByRole: isAdminOrManager ? (isAdmin ? 'admin' : 'manager') : 'delivery_partner'
    });

    const shouldReleaseLoad = Boolean(
      assignedPartnerId &&
      ['delivered', 'cancelled'].includes(status) &&
      !['delivered', 'cancelled'].includes(previousStatus)
    );

    await existingOrder.save();

    if (shouldReleaseLoad) {
      await adjustDeliveryPartnerLoad(assignedPartnerId, -1);
    }

    const order = await Order.findById(id).populate('customer');

    // Generate invoice when order is delivered (for COD orders)
    if (status === 'delivered' && order.payment?.method === 'cod') {
      const InvoiceService = require('../services/invoiceService');
      InvoiceService.generateInvoice(order._id.toString())
        .then(invoiceResult => {
          logger.info('Invoice generated for delivered COD order: ' + invoiceResult.invoice.invoiceNumber);
          // Send invoice email if mail service available
          const mailService = require('../services/mail.service');
          if (mailService && mailService.sendInvoiceEmail) {
            mailService.sendInvoiceEmail({
              customerName: order.customer?.name || 'Customer',
              customerEmail: order.customer?.email,
              invoiceNumber: invoiceResult.invoice.invoiceNumber,
              pdfPath: invoiceResult.pdfPath
            }).catch(err => logger.error('Invoice email send failed:', err));
          }
        })
        .catch(err => {
          // Don't fail the status update if invoice generation fails
          if (!err.message.includes('already exists')) {
            logger.error('Invoice generation failed:', err);
          }
        });
    }

    res.json({ ok: true, order });
  } catch (err) {
    next(err);
  }
};

// ACCEPT DELIVERY - Assign delivery partner to order

exports.acceptDelivery = async (req, res, next) => {
  try {
    const { id } = req.params;
    const isDeliveryPartner = hasAnyRole(req.user?.roles, ['delivery_partner']);
    
    if (!isDeliveryPartner) {
      return res.status(403).json({ error: 'Only delivery partners can accept deliveries' });
    }

    const order = await Order.findById(id).populate('customer', 'name email phone');
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Check if order is in accepted zone
    const assignedZones = await getAssignedZonesForDeliveryUser(req.user.id);
    const canAccessOrder = isOrderInAnyAssignedZone(order, assignedZones);
    
    if (!canAccessOrder) {
      return res.status(403).json({ error: 'Order is outside your assigned area' });
    }

    // Check if order already has a delivery partner
    if (hasAnyAssignedPartner(order)) {
      return res.status(400).json({ error: 'Order already assigned to a delivery partner' });
    }

    // Check if order is in acceptable status
    if (!['pending', 'confirmed', 'packed'].includes(order.status)) {
      return res.status(400).json({ error: `Cannot accept order with status: ${order.status}` });
    }

    // Get delivery partner details
    const partner = await User.findById(req.user.id);
    
    // Assign delivery partner to order
    order.assignedDeliveryPartner = partner._id;
    order.assignedAt = new Date();
    order.assignedBy = req.user.id;

    order.deliveryPartner = buildDeliveryPartnerSnapshot(partner);

    // Update order status to processing and initialize delivery timeline status
    order.status = 'processing';
    order.deliveryStatus = 'Accepted';
    order.orderStatus = 'PREPARING';

    if (!order.statusHistory) order.statusHistory = [];
    order.statusHistory.push({
      status: 'Accepted',
      timestamp: new Date(),
      updatedBy: req.user.id,
      updatedByRole: 'delivery_partner'
    });

    // Set customer location from shipping address if available
    if (order.shippingAddress?.latitude && order.shippingAddress?.longitude) {
      order.customerLocation = {
        lat: order.shippingAddress.latitude,
        lng: order.shippingAddress.longitude
      };
    }

    // Add to timeline
    if (!order.timeline) order.timeline = [];
    order.timeline.push({
      status: 'PREPARING',
      timestamp: new Date()
    });

    // Add to delivery updates
    if (!order.deliveryUpdates) order.deliveryUpdates = [];
    order.deliveryUpdates.push({
      status: 'processing',
      note: 'Delivery partner accepted the order',
      updatedBy: req.user.id,
      updatedByRole: 'delivery_partner',
      updatedAt: new Date()
    });

    await order.save();
    await adjustDeliveryPartnerLoad(partner._id, 1);

    // Send notification to customer (if notification service exists)
    try {
      const mailService = require('../services/mail.service');
      if (mailService && mailService.sendOrderUpdateEmail) {
        mailService.sendOrderUpdateEmail({
          customerName: order.customer?.name || 'Customer',
          customerEmail: order.customer?.email,
          orderId: order._id,
          status: 'processing',
          deliveryPartner: order.deliveryPartner,
          trackingUrl: getOrderTrackUrl(order._id)
        }).catch(err => logger.error('Order update email failed:', err));
      }
    } catch (err) {
      logger.info('Mail service not available:', err.message);
    }

    res.json({ 
      ok: true, 
      order,
      trackingUrl: getOrderTrackUrl(order._id)
    });
  } catch (err) {
    logger.error('❌ Error accepting delivery:', err);
    next(err);
  }
};

// ==================== USERS ====================

exports.assignDeliveryPartner = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { deliveryPartnerId } = req.body;

    if (!deliveryPartnerId) {
      return res.status(400).json({
        ok: false,
        error: 'Delivery partner ID is required'
      });
    }

    // Verify order exists
    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ ok: false, error: 'Order not found' });
    }

    // Verify user exists and has delivery_partner role
    const deliveryPartner = await User.findById(deliveryPartnerId);
    if (!deliveryPartner) {
      return res.status(404).json({ ok: false, error: 'Delivery partner not found' });
    }

    if (!deliveryPartner.roles || !deliveryPartner.roles.includes('delivery_partner')) {
      return res.status(400).json({
        ok: false,
        error: 'User must have delivery_partner role'
      });
    }

    if (['delivered', 'cancelled', 'failed'].includes(order.status)) {
      return res.status(400).json({
        ok: false,
        error: `Cannot assign delivery partner to ${order.status} order`
      });
    }

    const previousPartnerId = order.assignedDeliveryPartner || order.deliveryPartner?.id || order.deliveryPartner?.riderId;

    // Assign the delivery partner
    order.assignedDeliveryPartner = deliveryPartnerId;
    order.assignedAt = new Date();
    order.assignedBy = req.user.id;

    // Update deliveryPartner info for tracking
    order.deliveryPartner = buildDeliveryPartnerSnapshot(deliveryPartner);
    if (!order.deliveryStatus || order.deliveryStatus === 'Cancelled') {
      order.deliveryStatus = 'Order Placed';
    }

    // Add to delivery updates
    order.deliveryUpdates = order.deliveryUpdates || [];
    order.deliveryUpdates.push({
      status: order.status,
      note: previousPartnerId && String(previousPartnerId) !== String(deliveryPartnerId)
        ? `Reassigned to ${deliveryPartner.name || deliveryPartner.email}`
        : `Assigned to ${deliveryPartner.name || deliveryPartner.email}`,
      updatedBy: req.user.id,
      updatedByRole: hasAnyRole(req.user?.roles, ['admin']) ? 'admin' : 'manager',
      updatedAt: new Date()
    });

    await order.save();

    try {
      if (previousPartnerId && String(previousPartnerId) !== String(deliveryPartnerId)) {
        await adjustDeliveryPartnerLoad(previousPartnerId, -1);
      }
      if (!previousPartnerId || String(previousPartnerId) !== String(deliveryPartnerId)) {
        await adjustDeliveryPartnerLoad(deliveryPartnerId, 1);
      }
    } catch (loadErr) {
      logger.warn('Failed to bump delivery partner load on manual assign:', loadErr);
    }

    // Emit socket event for real-time updates
    if (req.app.get('io')) {
      req.app.get('io').emit('order-assigned', {
        orderId: order._id,
        deliveryPartner: order.deliveryPartner,
        timestamp: new Date()
      });
    }

    res.json({
      ok: true,
      message: 'Delivery partner assigned successfully',
      order
    });
  } catch (error) {
    logger.error('Error assigning delivery partner:', error);
    next(error);
  }
};

/**
 * Unassign delivery partner from an order
 * POST /api/admin/orders/:id/unassign
 */

exports.unassignDeliveryPartner = async (req, res, next) => {
  try {
    const { id } = req.params;

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ ok: false, error: 'Order not found' });
    }

    if (!hasAnyAssignedPartner(order)) {
      return res.status(400).json({
        ok: false,
        error: 'Order has no assigned delivery partner'
      });
    }

    // Remove assignment
    const previousPartner = order.assignedDeliveryPartner || order.deliveryPartner?.id || order.deliveryPartner?.riderId;
    order.assignedDeliveryPartner = undefined;
    order.assignedAt = undefined;
    order.assignedBy = undefined;
    order.deliveryPartner = undefined;
    if (order.deliveryStatus !== 'Delivered' && order.deliveryStatus !== 'Cancelled') {
      order.deliveryStatus = 'Order Placed';
    }

    // Add to delivery updates
    order.deliveryUpdates = order.deliveryUpdates || [];
    order.deliveryUpdates.push({
      status: order.status,
      note: 'Delivery partner assignment removed',
      updatedBy: req.user.id,
      updatedByRole: hasAnyRole(req.user?.roles, ['admin']) ? 'admin' : 'manager',
      updatedAt: new Date()
    });

    await order.save();

    try {
      await adjustDeliveryPartnerLoad(previousPartner, -1);
    } catch (loadErr) {
      logger.warn('Failed to decrement delivery partner load on unassign:', loadErr);
    }

    // Emit socket event
    if (req.app.get('io')) {
      req.app.get('io').emit('order-unassigned', {
        orderId: order._id,
        previousPartner,
        timestamp: new Date()
      });
    }

    res.json({
      ok: true,
      message: 'Delivery partner unassigned successfully',
      order
    });
  } catch (error) {
    logger.error('Error unassigning delivery partner:', error);
    next(error);
  }
};


