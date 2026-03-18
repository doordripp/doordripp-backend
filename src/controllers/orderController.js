const Order = require('../models/Order');
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

/**
 * Automatically assign an available delivery partner to an order
 * Returns the deliveryInfo (zone + managers) used for assignment.
 */
async function autoAssignDeliveryPartner(order, existingDeliveryInfo = null) {
  let deliveryInfo = existingDeliveryInfo;

  try {
    if (!deliveryInfo) {
      deliveryInfo = await getDeliveryZoneAndManagers(order.shippingAddress);
    }

    if (deliveryInfo?.zone) {
      const User = require('../models/User');
      // Prefer partners explicitly assigned to this zone, but fall back to any active delivery partner
      let partners = await User.find({
        roles: 'delivery_partner',
        'deliveryPartner.assignedArea': deliveryInfo.zone._id,
        isBanned: false
      });

      if (!partners.length) {
        partners = await User.find({
          roles: 'delivery_partner',
          isBanned: false
        });
      }

      if (partners.length > 0) {
        const availablePartners = partners.filter(p =>
          (p.deliveryPartner?.currentLoad || 0) < (p.deliveryPartner?.maxOrdersPerSlot || 10)
        );

        if (availablePartners.length > 0) {
          availablePartners.sort((a, b) =>
            (a.deliveryPartner?.currentLoad || 0) - (b.deliveryPartner?.currentLoad || 0)
          );

          const selectedPartner = availablePartners[0];

          order.assignedDeliveryPartner = selectedPartner._id;
          order.assignedAt = new Date();

          order.deliveryPartner = {
            id: selectedPartner._id,
            riderId: selectedPartner._id,
            name: selectedPartner.name,
            phone: selectedPartner.phone,
            photo: selectedPartner.avatar || selectedPartner.profileImage || selectedPartner.profilePhoto || '',
            rating: selectedPartner.rating || 4.8,
            vehicleType: selectedPartner.deliveryPartner?.vehicleType || 'Bike'
          };

          selectedPartner.deliveryPartner.currentLoad = (selectedPartner.deliveryPartner.currentLoad || 0) + 1;
          await selectedPartner.save();

          if (!Array.isArray(order.deliveryUpdates)) {
            order.deliveryUpdates = [];
          }

          order.deliveryUpdates.push({
            status: order.status,
            note: `Auto-assigned to delivery partner: ${selectedPartner.name}`,
            updatedByRole: 'system',
            updatedAt: new Date()
          });

          await order.save();
          console.log(`✅ Auto-assigned order ${order._id} to partner ${selectedPartner.name}`);
        } else {
          console.log(`⚠️ All partners for zone ${deliveryInfo.zone.name} are at max capacity. Kept unassigned.`);
        }
      } else {
        console.log(`⚠️ No delivery partners found for zone ${deliveryInfo.zone.name}.`);
      }
    } else {
      console.log('⚠️ No delivery zone matched for this order. Skipping auto-assignment.');
    }
  } catch (err) {
    console.error('Failed to auto-assign delivery partner:', err);
  }

  return deliveryInfo;
}

exports.autoAssignDeliveryPartner = autoAssignDeliveryPartner;

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

    // Build list of products to check and reserve
    const reservationList = isTrial ? trialItems : orderItems;

    // 1. Initial validation and stock check
    for (const it of reservationList) {
      const pid = it.product || it.productId || it._id;
      const product = await Product.findById(pid);
      if (!product) return res.status(400).json({ error: 'Invalid product in list: ' + pid });

      const quantity = it.quantity || 1;
      const availableStock = product.stock - (product.reserved || 0);
      if (availableStock < quantity) {
        return res.status(400).json({ error: `Out of stock for "${product.name}". Only ${availableStock} left.` });
      }
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

    // 2. Actually reserve the stock
    for (const it of reservationList) {
      const pid = it.product || it.productId || it._id;
      const quantity = it.quantity || 1;
      await Product.findByIdAndUpdate(pid, { $inc: { reserved: quantity } });
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

    if (order.payment?.status === 'success') {
      return res.json({ message: 'Payment already verified', order });
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

      if (!isValid) {
        console.error('❌ Invalid payment signature for order:', orderId);
        // Release reserved stock on failed verification
        const reservationReleaseList = order.isTrial ? order.trialItems : order.items;
        for (const it of reservationReleaseList) {
          await Product.findByIdAndUpdate(it.product, { $inc: { reserved: -(it.quantity || 1) } });
        }
        // Explicitly mark order as failed
        order.status = 'failed';
        order.payment.status = 'failed';
        await order.save();
        return res.status(400).json({ error: 'Payment verification failed' });
      }
    }

    if (skipVerification) {
      console.log('✅ Payment verification SKIPPED (test mode)');
    } else {
      console.log('✅ Payment signature verified');
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
    console.log('✅ Payment verified successfully for order:', orderId);

    // Finalize stock reduction (from reserved to actual deducted)
    for (const item of order.items) {
      await Product.findByIdAndUpdate(item.product, {
        $inc: { stock: -item.quantity, reserved: -item.quantity }
      });
    }

    // For other trial items, keep them reserved while they are "out" for trial
    // but the purchased item reservation is already handled above ^
    if (order.isTrial) {
      for (const ti of order.trialItems) {
        // If NOT the purchased item, keep it in "reserved" state while with customer
        // Wait, the Purchased Item ID is order.items[0].product
        const isPurchased = order.items.some(it => it.product.toString() === ti.product.toString());
        if (!isPurchased) {
          // We already reserved it in .create(). We keep it reserved. 
          // When the rider brings it back and marks order as "Finalized/Returned", we should unreserve.
          // For now, doing nothing here keeps it reserved.
        }
      }
    }
    console.log('✅ Stock updated for order:', orderId);

    // Find assigned managers for this delivery area and auto-assign delivery partner
    const deliveryInfo = await autoAssignDeliveryPartner(order);

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
    // deliveryInfo already retrieved above
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
    if (err?.name === 'VoucherError') {
      return res.status(err.status || 400).json({ error: err.message });
    }
    next(err);
  }
};

/**
 * Mark payment as failed
 */
exports.markPaymentFailed = async (req, res, next) => {
  try {
    const { orderId } = req.body;
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (String(order.customer) !== String(req.user.id)) return res.status(403).json({ error: 'Unauthorized' });

    if (order.status === 'pending') {
      order.status = 'failed';
      order.payment.status = 'failed';

      // Release reserved products
      const reservationReleaseList = order.isTrial ? (order.trialItems || []) : (order.items || []);
      for (const it of reservationReleaseList) {
        if (it.product) {
          await Product.findByIdAndUpdate(it.product, {
            $inc: { reserved: -(it.quantity || 1) }
          });
        }
      }

      await order.save();
    }
    res.json({ success: true, message: 'Order payment marked as failed', order });
  } catch (err) {
    next(err);
  }
};

exports.get = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id).populate('customer').populate('items.product');
    if (!order) return res.status(404).json({ error: 'Not found' });

    const roles = req.user.roles || [];
    const isAdminOrManager = roles.includes('admin') || roles.includes('manager');

    if (String(order.customer._id) !== String(req.user.id) && !isAdminOrManager) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.json(order);
  } catch (err) {
    next(err);
  }
};

/**
 * List all orders (admin & manager)
 */
exports.list = async (req, res, next) => {
  try {
    // Allow admins/managers to list all orders. For regular users, return only their orders.
    const roles = req.user.roles || [];
    const isAdminOrManager = roles.includes('admin') || roles.includes('manager');
    const { status, sort = '-createdAt', limit = 20, page = 1 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    let query = {}
    if (status) query.status = status

    if (!isAdminOrManager) {
      // restrict to current user's orders
      query.customer = req.user.id
    }

    // Populate customer for admins/managers, and product references for items for richer client-side rendering
    const q = Order.find(query)
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))

    if (isAdminOrManager) q.populate('customer', 'name email phone')
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
    const validStatuses = ['pending', 'confirmed', 'accepted', 'picked_up', 'out_for_delivery', 'delivered', 'failed', 'cancelled'];

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
    if (['out_for_delivery', 'delivered', 'cancelled'].includes(order.status)) {
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
