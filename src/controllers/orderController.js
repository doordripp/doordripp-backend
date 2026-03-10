const Order = require('../models/Order');
const logger = require('../utils/logger');
const Product = require('../models/Product');
const RazorpayUtil = require('../utils/razorpay');
const mailService = require('../services/mail.service');
const DeliveryZone = require('../models/DeliveryZone');
const AreaManager = require('../models/AreaManager');
const voucherService = require('../services/voucher.service');

const DELIVERY_OPTIONS = {
  regular: { charge: 80, eta: '45 minutes', label: 'Regular Delivery' },
  standard: { charge: 100, eta: '35 minutes', label: 'Standard Delivery' },
  priority: { charge: 120, eta: '25 minutes', label: 'Priority Delivery' }
};

/**
 * Calculate distance between two coordinates (in km) using Haversine formula
 */
function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Check if a point is inside a polygon using ray casting algorithm
 */
function isPointInPolygon(point, polygon) {
  const lat = point.lat;
  const lng = point.lng;
  let isInside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng, yi = polygon[i].lat;
    const xj = polygon[j].lng, yj = polygon[j].lat;

    const intersect = ((yi > lat) !== (yj > lat)) &&
                      (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) isInside = !isInside;
  }

  return isInside;
}

/**
 * Check if address falls within a delivery zone
 */
function isAddressInZone(address, zone) {
  // If address doesn't have coordinates, we can't determine location
  if (!address?.latitude || !address?.longitude) {
    logger.info(`⚠️ Address missing coordinates: lat=${address?.latitude}, lng=${address?.longitude}`);
    return false;
  }

  const addressLat = parseFloat(address.latitude);
  const addressLng = parseFloat(address.longitude);

  if (isNaN(addressLat) || isNaN(addressLng)) {
    logger.info(`⚠️ Invalid address coordinates`);
    return false;
  }

  if (zone.type === 'radius' && zone.center) {
    // For radius zones, check distance from center
    const distance = calculateDistance(
      zone.center.lat,
      zone.center.lng,
      addressLat,
      addressLng
    );
    const withinRadius = distance <= zone.radiusKm;
    logger.info(`  📍 Radius zone "${zone.name}": distance=${distance.toFixed(2)}km, radius=${zone.radiusKm}km -> ${withinRadius ? '✅' : '❌'}`);
    return withinRadius;
  } else if (zone.type === 'polygon' && zone.polygon && zone.polygon.length > 0) {
    // For polygon zones, check if point is inside polygon
    const isInside = isPointInPolygon(
      { lat: addressLat, lng: addressLng },
      zone.polygon
    );
    logger.info(`  🔷 Polygon zone "${zone.name}": point inside polygon -> ${isInside ? '✅' : '❌'}`);
    return isInside;
  }

  return false;
}

/**
 * Helper: Find delivery zone for an address and get assigned managers
 */
async function getDeliveryZoneAndManagers(address) {
  try {
    if (!address) {
      logger.info('⚠️ No address provided');
      return null;
    }

    logger.info(`🔍 Looking for zone matching address:`, {
      city: address.city,
      latitude: address.latitude,
      longitude: address.longitude
    });

    // Find delivery zones that cover this address
    const zones = await DeliveryZone.find({ isActive: true });
    logger.info(`📍 Found ${zones.length} active delivery zones`);
    
    for (const zone of zones) {
      logger.info(`  Checking zone: "${zone.name}" (type: ${zone.type})`);
      
      // Try GPS-based matching first (most accurate)
      if (address.latitude && address.longitude) {
        if (isAddressInZone(address, zone)) {
          logger.info(`✅ Address matched to zone via GPS: "${zone.name}"`);
          
          // Get assigned managers for this zone
          const assignments = await AreaManager.find({
            deliveryZone: zone._id,
            status: 'active'
          }).populate('manager', 'name email phone');

          logger.info(`👥 Found ${assignments.length} active manager(s) for zone: ${zone.name}`);
          
          if (assignments.length === 0) {
            logger.warn(`⚠️ Zone "${zone.name}" has no active assigned managers`);
          }

          return {
            zone,
            managers: assignments.map(a => ({
              name: a.manager.name,
              email: a.manager.email,
              phone: a.manager.phone
            }))
          };
        }
      }
    }

    logger.info(`❌ No matching zone found for address`);
    return null;
  } catch (err) {
    logger.error('Error finding delivery zone:', err);
    return null;
  }
}

exports.create = async (req, res, next) => {
  try {
    const {
      items,
      shippingAddress,
      deliveryType = 'regular',
      trialFee = 0,
      isTrial = false,
      trialItems = [],
      voucherCode
    } = req.body;
    if (!items || !items.length) return res.status(400).json({ error: 'No items' });

    const parsedTrialFee = Number(trialFee);
    const safeTrialFee = Number.isFinite(parsedTrialFee) && parsedTrialFee >= 0 ? parsedTrialFee : 0;

    // Validate and use delivery options constants
    const selectedDelivery = DELIVERY_OPTIONS[deliveryType] || DELIVERY_OPTIONS.regular;
    const deliveryFee = selectedDelivery.charge;
    const deliveryETA = selectedDelivery.eta;

    // build order items
    let subtotal = 0;
    const orderItems = [];
    
    for (const it of items) {
      const quantity = Number(it.quantity);
      if (!Number.isInteger(quantity) || quantity <= 0) {
        return res.status(400).json({ error: 'Invalid quantity for product ' + it.product });
      }

      const product = await Product.findById(it.product);
      if (!product) return res.status(400).json({ error: 'Invalid product ' + it.product });
      // Check available stock (stock - reserved)
      const availableStock = product.stock - (product.reserved || 0);
      if (availableStock < quantity) return res.status(400).json({ error: 'Out of stock for ' + product.name });
      
      const price = product.price;
      const itemTotal = price * quantity;
      subtotal += itemTotal;
      
      orderItems.push({
        product: product._id,
        name: product.name,
        quantity,
        price,
        itemTotal,
        gstRate: 0,
        cgst: 0,
        sgst: 0,
        igst: 0
      });
    }

    // Calculate final totals
    const discountBase = subtotal;
    const totalBeforeDiscount = subtotal + deliveryFee + safeTrialFee;
    let voucherDiscount = 0;
    let total = totalBeforeDiscount;
    let voucher = undefined;

    const normalizedVoucherCode = voucherService.normalizeCode(voucherCode);
    if (normalizedVoucherCode) {
      const voucherResult = await voucherService.validateVoucherForUser({
        code: normalizedVoucherCode,
        cartTotal: discountBase,
        userId: req.user.id
      });

      voucherDiscount = voucherResult.discount;
      total = (discountBase - voucherDiscount) + deliveryFee + safeTrialFee;
      voucher = {
        voucherId: voucherResult.voucher._id,
        code: voucherResult.voucher.code,
        discountType: voucherResult.voucher.discountType,
        discountValue: voucherResult.voucher.discountValue,
        discountAmount: voucherResult.discount,
        usageApplied: false
      };
    }

    if (total <= 0) {
      return res.status(400).json({ error: 'Payable amount must be greater than 0 after voucher discount' });
    }

    // create a Razorpay order (amount in paise)
    const razorOrder = await RazorpayUtil.createOrder({ amount: Math.round(total * 100), currency: 'INR' });

    const order = await Order.create({
      customer: req.user.id,
      items: orderItems,
      subtotal,
      cgstTotal: 0,
      sgstTotal: 0,
      igstTotal: 0,
      totalGST: 0,
      deliveryFee,
      trialFee: safeTrialFee,
      isTrial,
      trialItems,
      deliveryType,
      deliveryETA,
      totalBeforeDiscount,
      voucherDiscount,
      voucher,
      total,
      status: 'pending',
      payment: { razorpayOrderId: razorOrder.id, status: 'pending' },
      shippingAddress
    });

    // RESERVE stock (mark as reserved but don't reduce available stock yet)
    for (const it of orderItems) {
      await Product.findByIdAndUpdate(it.product, { $inc: { reserved: it.quantity } });
    }

    res.status(201).json({
      order,
      razorOrder,
      pricing: {
        discountBase,
        totalBeforeDiscount,
        voucherDiscount,
        payableTotal: total
      }
    });
  } catch (err) {
    if (err?.name === 'VoucherError') {
      return res.status(err.status || 400).json({ error: err.message });
    }
    next(err);
  }
};

/**
 * Verify Razorpay payment signature and finalize order
 * Called after successful payment
 */
exports.verifyPayment = async (req, res, next) => {
  try {
    const { orderId, razorpayPaymentId, razorpaySignature } = req.body;
    
    if (!orderId || !razorpayPaymentId || !razorpaySignature) {
      logger.error('❌ Missing payment details:', { orderId, razorpayPaymentId, razorpaySignature });
      return res.status(400).json({ error: 'Missing payment details' });
    }

    const order = await Order.findById(orderId).populate('customer');
    if (!order) {
      logger.error('❌ Order not found:', orderId);
      return res.status(404).json({ error: 'Order not found' });
    }

    // Verify user owns this order
    if (String(order.customer._id) !== String(req.user.id)) {
      logger.error('❌ Unauthorized access to order:', orderId);
      return res.status(403).json({ error: 'Unauthorized' });
    }

    if (order.payment?.status === 'success') {
      return res.json({ message: 'Payment already verified', order });
    }

    // Verify Razorpay signature
    logger.info('🔍 Verifying payment signature...');
    
    // In test mode, allow bypass if RAZORPAY_TEST_MODE_SKIP_VERIFICATION is set
    const isTestMode = process.env.RAZORPAY_KEY_ID?.includes('rzp_test');
    const skipVerification = isTestMode && process.env.RAZORPAY_TEST_MODE_SKIP_VERIFICATION === 'true';
    
    let isValid = false;
    if (skipVerification) {
      logger.warn('⚠️ SKIPPING signature verification (test mode enabled)');
      isValid = true;
    } else {
      isValid = RazorpayUtil.verifyPaymentSignature(
        order.payment.razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature
      );
    }

    if (!isValid) {
      logger.error('❌ Invalid payment signature for order:', orderId);
      // Release reserved stock on failed verification
      for (const it of order.items) {
        await Product.findByIdAndUpdate(it.product, { $inc: { reserved: -it.quantity } });
      }
      return res.status(400).json({ error: 'Invalid payment signature' });
    }
    
    if (skipVerification) {
      logger.info('✅ Payment verification SKIPPED (test mode)');
    } else {
      logger.info('✅ Payment signature verified');
    }

    if (order.voucher?.voucherId && !order.voucher?.usageApplied) {
      await voucherService.consumeVoucherUsage({
        voucherId: order.voucher.voucherId,
        userId: req.user.id
      });
      order.voucher.usageApplied = true;
    }

    // Update order payment status
    order.payment.transactionId = razorpayPaymentId;
    order.payment.status = 'success';
    order.status = 'confirmed';
    await order.save();
    logger.info('✅ Payment verified successfully for order:', orderId);

    // DECREMENT actual stock (payment successful)
    for (const it of order.items) {
      await Product.findByIdAndUpdate(it.product, { 
        $inc: { stock: -it.quantity, reserved: -it.quantity } 
      });
    }
    logger.info('✅ Stock updated for order:', orderId);

    // Generate invoice for paid order (non-blocking)
    const InvoiceService = require('../services/invoiceService');
    InvoiceService.generateInvoice(order._id.toString())
      .then(invoiceResult => {
        logger.info(`✅ Invoice generated: ${invoiceResult.invoice.invoiceNumber}`);
        // Send invoice email if mail service available
        if (mailService && mailService.sendInvoiceEmail) {
          mailService.sendInvoiceEmail({
            customerName: order.customer.name,
            customerEmail: order.customer.email,
            invoiceNumber: invoiceResult.invoice.invoiceNumber,
            pdfPath: invoiceResult.pdfPath
          }).catch(err => logger.error('Invoice email send failed:', err));
        }
      })
      .catch(err => logger.error('Invoice generation failed:', err));

    // Send confirmation email to customer (non-blocking)
    if (mailService && mailService.sendOrderConfirmation) {
      mailService.sendOrderConfirmation({
        customerName: order.customer.name,
        customerEmail: order.customer.email,
        orderId: order._id.toString(),
        orderDate: order.createdAt,
        items: order.items.map(it => ({
          name: it.name,
          quantity: it.quantity,
          price: it.price
        })),
        totalAmount: order.total,
        shippingAddress: order.shippingAddress
      }).catch(err => logger.error('Customer email send failed:', err));
    }

    // Find assigned managers for this delivery area and send them notifications (non-blocking)
    const deliveryInfo = await getDeliveryZoneAndManagers(order.shippingAddress);
    if (deliveryInfo?.managers?.length > 0) {
      const managerEmails = deliveryInfo.managers.map(m => m.email);
      logger.info(`📧 Sending order notification to ${managerEmails.length} manager(s): ${managerEmails.join(', ')}`);
      
      // Send manager notification email with customer details
      for (const manager of deliveryInfo.managers) {
        if (mailService && mailService.sendManagerOrderNotification) {
          mailService.sendManagerOrderNotification({
            managerName: manager.name,
            managerEmail: manager.email,
            customerName: order.customer.name,
            customerPhone: order.shippingAddress.phone || order.customer.phone || 'N/A',
            orderId: order._id.toString(),
            orderDate: order.createdAt,
            items: order.items.map(it => ({
              name: it.name,
              quantity: it.quantity,
              price: it.price
            })),
            totalAmount: order.total,
            shippingAddress: order.shippingAddress,
            zoneName: deliveryInfo.zone?.name
          }).catch(err => logger.error('Manager email send failed:', err));
        }
      }
      
      logger.info(`✅ Order notification sent to ${managerEmails.length} manager(s) for zone: ${deliveryInfo.zone.name}`);
    } else {
      logger.warn('⚠️ No managers found for this delivery area');
    }

    res.json({ message: 'Payment verified successfully', order });
  } catch (err) {
    if (err?.name === 'VoucherError') {
      return res.status(err.status || 400).json({ error: err.message });
    }
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

/**
 * List all orders (admin only)
 */
exports.list = async (req, res, next) => {
  try {
    // Allow admins to list all orders. For regular users, return only their orders.
    const isAdmin = req.user.roles && req.user.roles.includes('admin')
    const { status, sort = '-createdAt', limit = 20, page = 1 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    let query = {}
    if (status) query.status = status

    if (!isAdmin) {
      // restrict to current user's orders
      query.customer = req.user.id
    }

    // Populate customer for admins, and product references for items for richer client-side rendering
    const q = Order.find(query)
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))

    if (isAdmin) q.populate('customer', 'name email phone')
    // always populate products inside items where possible
    q.populate('items.product')

    const orders = await q.exec()

    const total = await Order.countDocuments(query)

    res.json({ orders, pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) } })
  } catch (err) {
    next(err);
  }
};

/**
 * Update order status (admin only)
 */
exports.updateStatus = async (req, res, next) => {
  try {
    if (!req.user.roles || !req.user.roles.includes('admin')) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { status, trackingNumber } = req.body;
    const validStatuses = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];

    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Valid statuses: ${validStatuses.join(', ')}` });
    }

    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { 
        status,
        ...(trackingNumber && { trackingNumber })
      },
      { new: true }
    ).populate('customer');

    if (!order) return res.status(404).json({ error: 'Order not found' });

    res.json({ message: 'Order status updated', order });
  } catch (err) {
    next(err);
  }
};

/**
 * Cancel order and release stock (admin or customer)
 */
exports.cancel = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id).populate('customer');
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // Check authorization
    const isOwner = String(order.customer._id) === String(req.user.id);
    const isAdmin = req.user.roles && req.user.roles.includes('admin');
    
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Only allow cancellation of pending/confirmed orders
    if (['shipped', 'delivered', 'cancelled'].includes(order.status)) {
      return res.status(400).json({ error: `Cannot cancel order with status: ${order.status}` });
    }

    // Release reserved stock
    for (const it of order.items) {
      if (order.status === 'pending') {
        // For pending: release reserved only
        await Product.findByIdAndUpdate(it.product, { $inc: { reserved: -it.quantity } });
      } else if (order.status === 'confirmed') {
        // For confirmed: restore stock and release reserved
        await Product.findByIdAndUpdate(it.product, {
          $inc: { stock: it.quantity, reserved: -it.quantity }
        });
      }
    }

    order.status = 'cancelled';
    await order.save();

    res.json({ message: 'Order cancelled successfully', order });
  } catch (err) {
    next(err);
  }
};

module.exports = exports;
