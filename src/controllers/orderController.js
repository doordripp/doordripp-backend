const Order = require('../models/Order');
const Product = require('../models/Product');
const RazorpayUtil = require('../utils/razorpay');
const mailService = require('../services/mail.service');
const DeliveryZone = require('../models/DeliveryZone');
const AreaManager = require('../models/AreaManager');
const User = require('../models/User');
const { calculateItemGST } = require('../utils/gstCalculator');

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
    console.log(`⚠️ Address missing coordinates: lat=${address?.latitude}, lng=${address?.longitude}`);
    return false;
  }

  const addressLat = parseFloat(address.latitude);
  const addressLng = parseFloat(address.longitude);

  if (isNaN(addressLat) || isNaN(addressLng)) {
    console.log(`⚠️ Invalid address coordinates`);
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
    console.log(`  📍 Radius zone "${zone.name}": distance=${distance.toFixed(2)}km, radius=${zone.radiusKm}km -> ${withinRadius ? '✅' : '❌'}`);
    return withinRadius;
  } else if (zone.type === 'polygon' && zone.polygon && zone.polygon.length > 0) {
    // For polygon zones, check if point is inside polygon
    const isInside = isPointInPolygon(
      { lat: addressLat, lng: addressLng },
      zone.polygon
    );
    console.log(`  🔷 Polygon zone "${zone.name}": point inside polygon -> ${isInside ? '✅' : '❌'}`);
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
      console.log('⚠️ No address provided');
      return null;
    }

    console.log(`🔍 Looking for zone matching address:`, {
      city: address.city,
      latitude: address.latitude,
      longitude: address.longitude
    });

    // Find delivery zones that cover this address
    const zones = await DeliveryZone.find({ isActive: true });
    console.log(`📍 Found ${zones.length} active delivery zones`);
    
    for (const zone of zones) {
      console.log(`  Checking zone: "${zone.name}" (type: ${zone.type})`);
      
      // Try GPS-based matching first (most accurate)
      if (address.latitude && address.longitude) {
        if (isAddressInZone(address, zone)) {
          console.log(`✅ Address matched to zone via GPS: "${zone.name}"`);
          
          // Get assigned managers for this zone
          const assignments = await AreaManager.find({
            deliveryZone: zone._id,
            status: 'active'
          }).populate('manager', 'name email phone');

          console.log(`👥 Found ${assignments.length} active manager(s) for zone: ${zone.name}`);
          
          if (assignments.length === 0) {
            console.warn(`⚠️ Zone "${zone.name}" has no active assigned managers`);
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

    console.log(`❌ No matching zone found for address`);
    return null;
  } catch (err) {
    console.error('Error finding delivery zone:', err);
    return null;
  }
}

exports.create = async (req, res, next) => {
  try {
    const { items, shippingAddress, deliveryFee = 0 } = req.body;
    if (!items || !items.length) return res.status(400).json({ error: 'No items' });

    // Get buyer's state code from shipping address (default to seller state if not provided)
    const buyerStateCode = shippingAddress?.stateCode || process.env.SELLER_STATE_CODE || '27'; // Default: Maharashtra

    // build order items and calculate GST
    let subtotal = 0;
    let cgstTotal = 0;
    let sgstTotal = 0;
    let igstTotal = 0;
    const orderItems = [];
    
    for (const it of items) {
      const product = await Product.findById(it.product);
      if (!product) return res.status(400).json({ error: 'Invalid product ' + it.product });
      // Check available stock (stock - reserved)
      const availableStock = product.stock - (product.reserved || 0);
      if (availableStock < it.quantity) return res.status(400).json({ error: 'Out of stock for ' + product.name });
      
      const price = product.price;
      const itemTotal = price * it.quantity;
      subtotal += itemTotal;
      
      // Calculate GST for this item
      const gstRate = product.gstRate || 12; // Default to 12% if not specified
      const sellerStateCode = process.env.SELLER_STATE_CODE || '27'; // Default: Maharashtra
      
      const gstBreakdown = calculateItemGST({
        taxableAmount: itemTotal,
        gstRate,
        sellerStateCode,
        buyerStateCode
      });
      
      cgstTotal += gstBreakdown.cgst;
      sgstTotal += gstBreakdown.sgst;
      igstTotal += gstBreakdown.igst;
      
      orderItems.push({
        product: product._id,
        name: product.name,
        quantity: it.quantity,
        price,
        itemTotal,
        gstRate,
        cgst: gstBreakdown.cgst,
        sgst: gstBreakdown.sgst,
        igst: gstBreakdown.igst
      });
    }

    // Calculate final totals
    const totalGST = cgstTotal + sgstTotal + igstTotal;
    const total = subtotal + totalGST + deliveryFee;

    // create a Razorpay order (amount in paise)
    const razorOrder = await RazorpayUtil.createOrder({ amount: Math.round(total * 100), currency: 'INR' });

    const order = await Order.create({
      customer: req.user.id,
      items: orderItems,
      subtotal,
      cgstTotal,
      sgstTotal,
      igstTotal,
      totalGST,
      deliveryFee,
      total,
      status: 'pending',
      payment: { razorpayOrderId: razorOrder.id, status: 'pending' },
      shippingAddress,
      buyerStateCode
    });

    // RESERVE stock (mark as reserved but don't reduce available stock yet)
    for (const it of orderItems) {
      await Product.findByIdAndUpdate(it.product, { $inc: { reserved: it.quantity } });
    }

    res.status(201).json({ order, razorOrder });
  } catch (err) {
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
      console.error('❌ Missing payment details:', { orderId, razorpayPaymentId, razorpaySignature });
      return res.status(400).json({ error: 'Missing payment details' });
    }

    const order = await Order.findById(orderId).populate('customer');
    if (!order) {
      console.error('❌ Order not found:', orderId);
      return res.status(404).json({ error: 'Order not found' });
    }

    // Verify user owns this order
    if (String(order.customer._id) !== String(req.user.id)) {
      console.error('❌ Unauthorized access to order:', orderId);
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Verify Razorpay signature
    console.log('🔍 Verifying payment signature...');
    
    // In test mode, allow bypass if RAZORPAY_TEST_MODE_SKIP_VERIFICATION is set
    const isTestMode = process.env.RAZORPAY_KEY_ID?.includes('rzp_test');
    const skipVerification = isTestMode && process.env.RAZORPAY_TEST_MODE_SKIP_VERIFICATION === 'true';
    
    let isValid = false;
    if (skipVerification) {
      console.warn('⚠️ SKIPPING signature verification (test mode enabled)');
      isValid = true;
    } else {
      isValid = RazorpayUtil.verifyPaymentSignature(
        order.payment.razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature
      );
    }

    if (!isValid) {
      console.error('❌ Invalid payment signature for order:', orderId);
      // Release reserved stock on failed verification
      for (const it of order.items) {
        await Product.findByIdAndUpdate(it.product, { $inc: { reserved: -it.quantity } });
      }
      return res.status(400).json({ error: 'Invalid payment signature' });
    }
    
    if (skipVerification) {
      console.log('✅ Payment verification SKIPPED (test mode)');
    } else {
      console.log('✅ Payment signature verified');
    }

    // Update order payment status
    order.payment.transactionId = razorpayPaymentId;
    order.payment.status = 'success';
    order.status = 'confirmed';
    await order.save();
    console.log('✅ Payment verified successfully for order:', orderId);

    // DECREMENT actual stock (payment successful)
    for (const it of order.items) {
      await Product.findByIdAndUpdate(it.product, { 
        $inc: { stock: -it.quantity, reserved: -it.quantity } 
      });
    }
    console.log('✅ Stock updated for order:', orderId);

    // Generate invoice for paid order (non-blocking)
    const InvoiceService = require('../services/invoiceService');
    InvoiceService.generateInvoice(order._id.toString())
      .then(invoiceResult => {
        console.log(`✅ Invoice generated: ${invoiceResult.invoice.invoiceNumber}`);
        // Send invoice email if mail service available
        if (mailService && mailService.sendInvoiceEmail) {
          mailService.sendInvoiceEmail({
            customerName: order.customer.name,
            customerEmail: order.customer.email,
            invoiceNumber: invoiceResult.invoice.invoiceNumber,
            pdfPath: invoiceResult.pdfPath
          }).catch(err => console.error('Invoice email send failed:', err));
        }
      })
      .catch(err => console.error('Invoice generation failed:', err));

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
      }).catch(err => console.error('Customer email send failed:', err));
    }

    // Find assigned managers for this delivery area and send them notifications (non-blocking)
    const deliveryInfo = await getDeliveryZoneAndManagers(order.shippingAddress);
    if (deliveryInfo?.managers?.length > 0) {
      const managerEmails = deliveryInfo.managers.map(m => m.email);
      console.log(`📧 Sending order notification to ${managerEmails.length} manager(s): ${managerEmails.join(', ')}`);
      
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
          }).catch(err => console.error('Manager email send failed:', err));
        }
      }
      
      console.log(`✅ Order notification sent to ${managerEmails.length} manager(s) for zone: ${deliveryInfo.zone.name}`);
    } else {
      console.warn('⚠️ No managers found for this delivery area');
    }

    res.json({ message: 'Payment verified successfully', order });
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
