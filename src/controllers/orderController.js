const Order = require('../models/Order');
const Product = require('../models/Product');
const mongoose = require('mongoose');
const RazorpayUtil = require('../utils/razorpay');
const mailService = require('../services/mail.service');
const pushService = require('../services/pushNotification.service');
const notificationService = require('../services/notification.service');
const DeliveryZone = require('../models/DeliveryZone');
const AreaManager = require('../models/AreaManager');
const voucherService = require('../services/voucher.service');
const { getDeliveryChargeConfig, pickDeliveryOption } = require('../utils/deliveryChargeConfig');
const { getDefaultSize, normalizeSizeLabel } = require('../utils/productInventory');
const orderLifecycle = require('../services/orderLifecycle.service');
const { StockError } = require('../services/inventory.service');
const { TRIAL_FEE } = require('../config/trial');
const logger = require('../utils/logger');

const forwardControllerError = (next, res, err, fallbackMessage = 'Internal server error') => {
  if (typeof next === 'function') {
    return next(err);
  }

  console.error('Order controller fallback error:', err);
  if (res && !res.headersSent) {
    return res.status(err?.status || 500).json({ error: err?.message || fallbackMessage });
  }

  return null;
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
            managers: assignments
              .filter(a => a.manager)
              .map(a => ({
                _id: a.manager._id,
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

exports.getRazorpayConfig = async (req, res, next) => {
  try {
    const keyId = String(process.env.RAZORPAY_KEY_ID || '').trim();
    const webhookSecret = String(process.env.RAZORPAY_WEBHOOK_SECRET || '').trim();
    const mode = /^rzp_live_/i.test(keyId) ? 'live' : (/^rzp_test_/i.test(keyId) ? 'test' : 'unknown');
    const isReady = /^rzp_(test|live)_/i.test(keyId) && Boolean(webhookSecret);
    const requiresLive = process.env.NODE_ENV === 'production';

    res.json({
      keyId,
      ready: isReady,
      mode,
      requiresLive
    });
  } catch (err) {
    return forwardControllerError(next, res, err);
  }
};

exports.create = async (req, res, next) => {
  try {
    const {
      items,
      shippingAddress,
      deliveryType = 'regular',
      isTrial = false,
      trialItems = [],
      voucherCode,
      paymentMethod = 'online' // 'cod' or 'online'
    } = req.body;
    if (!items || !items.length) return res.status(400).json({ error: 'No items' });

    if (!Array.isArray(items) || items.length > 50) return res.status(400).json({ error: 'Invalid items' });

    const isCOD = paymentMethod === 'cod';
    const isTrialOrder = isTrial === true;
    // The trial fee is decided by the server. Whatever the client sends is ignored.
    const safeTrialFee = isTrialOrder ? TRIAL_FEE : 0;

    // Free up stock held by abandoned checkouts before trying to reserve.
    await orderLifecycle.expireStalePendingOrders().catch(err => logger.error('Stale order sweep failed', err));

    // Resolve delivery option from dynamic admin-configured settings.
    const deliveryChargeConfig = await getDeliveryChargeConfig();
    const selectedDelivery = pickDeliveryOption(deliveryChargeConfig, deliveryType);
    const resolvedDeliveryType = selectedDelivery.id;
    const deliveryFee = Number(selectedDelivery.charge) || 0;
    const deliveryETA = selectedDelivery.eta;

    // build order items
    let subtotal = 0;
    let totalGST = 0;
    let totalCGST = 0;
    let totalSGST = 0;
    const orderItems = [];

    for (const it of items) {
      const quantity = Number(it.quantity);
      if (!Number.isInteger(quantity) || quantity <= 0) {
        return res.status(400).json({ error: 'Invalid quantity for product ' + it.product });
      }

      const pIdStr = String(it.product || it.productId || it.id || '').trim();
      let product = null;
      if (mongoose.Types.ObjectId.isValid(pIdStr)) {
        product = await Product.findById(pIdStr);
      }
      if (!product) {
        product = await Product.findOne({ slug: pIdStr });
      }
      if (!product) return res.status(400).json({ error: 'Invalid product ' + it.product });
      const selectedSize = normalizeSizeLabel(it.selectedSize || it.size || getDefaultSize(product.sizeInventory, product.sizes));

      const price = product.price;
      const gstRate = product.gstRate || 5; // Default 5% if not set
      
      // Assume price is inclusive of GST
      const itemTaxableAmount = (price * quantity) / (1 + (gstRate / 100));
      const itemGST = (price * quantity) - itemTaxableAmount;
      const cgst = itemGST / 2;
      const sgst = itemGST / 2;

      subtotal += itemTaxableAmount;
      totalGST += itemGST;
      totalCGST += cgst;
      totalSGST += sgst;

      orderItems.push({
        product: product._id,
        name: product.name,
        // Snapshot of the product image, so the confirmation screen, order emails and
        // old orders still show it even if the product is later edited or removed.
        image: (Array.isArray(product.images) && product.images[0]) || undefined,
        quantity,
        size: selectedSize,
        price, // Original inclusive unit price
        itemTotal: price * quantity, 
        productSource: product.productSource || 'Manufacturer',
        gstRate,
        cgst: Math.round(cgst * 100) / 100,
        sgst: Math.round(sgst * 100) / 100,
        igst: 0
      });
    }

    // Calculate final totals
    // Discount Base is the sum of inclusive prices for voucher application
    const discountBaseSubtotal = orderItems.reduce((sum, it) => sum + it.itemTotal, 0); 
    
    // totalBeforeDiscount includes delivery and trial fees
    const totalBeforeDiscount = discountBaseSubtotal + deliveryFee + safeTrialFee;
    
    let voucherDiscount = 0;
    let total = totalBeforeDiscount;
    let voucher = undefined;

    const normalizedVoucherCode = voucherService.normalizeCode(voucherCode);
    if (normalizedVoucherCode) {
      const voucherResult = await voucherService.validateVoucherForUser({
        code: normalizedVoucherCode,
        cartTotal: discountBaseSubtotal,
        userId: req.user.id
      });

      voucherDiscount = voucherResult.discount;
      total = (discountBaseSubtotal - voucherDiscount) + deliveryFee + safeTrialFee;
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

    // Enrich trialItems with source if present
    const enrichedTrialItems = [];
    if (isTrialOrder && Array.isArray(trialItems)) {
      if (trialItems.length > 10) return res.status(400).json({ error: 'Too many trial items' });
      for (const ti of trialItems) {
        const pidStr = String(ti.product || ti.productId || ti._id || '').trim();
        let p = null;
        if (mongoose.Types.ObjectId.isValid(pidStr)) {
          p = await Product.findById(pidStr);
        }
        if (!p) {
          p = await Product.findOne({ slug: pidStr });
        }
        if (!p) return res.status(400).json({ error: 'Invalid trial product ' + pidStr });
        enrichedTrialItems.push({
          product: p._id,
          name: p.name,
          image: (p.images && p.images[0]) || p.image,
          // Price always comes from the catalogue, never from the request.
          price: p.price,
          size: normalizeSizeLabel(ti.size || ti.selectedSize || getDefaultSize(p.sizeInventory, p.sizes)),
          productSource: p.productSource || 'Manufacturer'
        });
      }
    }

    const roundedTotal = Math.round(total * 100) / 100;

    // Units this order takes out of stock: the trial selection for Trial & Buy, otherwise the purchased lines.
    const reservationLines = (isTrialOrder && enrichedTrialItems.length > 0 ? enrichedTrialItems : orderItems)
      .map(it => ({ product: it.product, size: it.size, quantity: it.quantity || 1, name: it.name }));

    const baseOrder = {
      customer: req.user.id,
      items: orderItems,
      subtotal: Math.round(subtotal * 100) / 100,
      cgstTotal: Math.round(totalCGST * 100) / 100,
      sgstTotal: Math.round(totalSGST * 100) / 100,
      igstTotal: 0,
      totalGST: Math.round(totalGST * 100) / 100,
      deliveryFee,
      trialFee: safeTrialFee,
      isTrial: isTrialOrder,
      trialItems: enrichedTrialItems,
      deliveryType: resolvedDeliveryType,
      deliveryETA,
      totalBeforeDiscount,
      voucherDiscount,
      voucher,
      total: roundedTotal,
      shippingAddress
    };

    const pricing = {
      discountBase: discountBaseSubtotal,
      totalBeforeDiscount,
      voucherDiscount,
      payableTotal: roundedTotal
    };

    // --- COD vs ONLINE payment branching ---
    if (isCOD) {
      // COD: no gateway. The order, its stock and its voucher use are written in
      // one transaction, so an out-of-stock line or a spent voucher creates nothing.
      const order = await orderLifecycle.createOrderWithReservation({
        orderData: {
          ...baseOrder,
          status: 'confirmed',
          payment: { method: 'cod', status: 'cod_pending', codAmount: roundedTotal }
        },
        reservationLines,
        userId: req.user.id
      });

      await order.populate('customer');
      await runOrderConfirmedEffects(order, { paymentLabel: 'Cash on Delivery', notifyStaffPush: true });

      return res.status(201).json({ order, paymentMethod: 'cod', pricing });
    }

    // --- ONLINE PAYMENT (Razorpay) ---
    const razorReceipt = `ord_${String(req.user.id).slice(-8)}_${Date.now()}`.slice(0, 40);
    let razorOrder;
    try {
      razorOrder = await RazorpayUtil.createOrder({
        amount: Math.round(total * 100),
        currency: 'INR',
        receipt: razorReceipt
      });
    } catch (razorError) {
      logger.error('Razorpay order creation failed', {
        message: razorError?.message,
        statusCode: razorError?.statusCode || razorError?.status,
        code: razorError?.error?.code
      });
      return res.status(502).json({ error: 'Payment gateway is unavailable. Please try again.' });
    }

    // Stock and voucher are held from this moment. They are released again if the
    // payment fails, is abandoned (see expireStalePendingOrders) or the order is cancelled.
    const order = await orderLifecycle.createOrderWithReservation({
      orderData: {
        ...baseOrder,
        status: 'pending',
        payment: { method: 'razorpay', razorpayOrderId: razorOrder.id, status: 'pending' }
      },
      reservationLines,
      userId: req.user.id
    });

    res.status(201).json({ order, razorOrder, paymentMethod: 'online', pricing });
  } catch (err) {
    if (err?.name === 'VoucherError') {
      return res.status(err.status || 400).json({ error: err.message });
    }
    if (err instanceof StockError) {
      return res.status(409).json({ error: err.message, code: err.code, items: err.items });
    }
    return forwardControllerError(next, res, err, 'Failed to create order');
  }
};

/**
 * Everything that should happen once, when an order becomes confirmed:
 * delivery assignment, invoice, emails, notifications, pushes and the Trial & Buy record.
 * Callers must only invoke this for the request that actually performed the
 * transition (see orderLifecycle.confirmPaidOrder), so nothing is sent twice.
 * All steps are best-effort and never fail the request.
 */
async function runOrderConfirmedEffects(order, { paymentLabel, notifyStaffPush = false } = {}) {
  const customer = order.customer || {};
  const deliveryInfo = await autoAssignDeliveryPartner(order);

  const InvoiceService = require('../services/invoiceService');
  InvoiceService.generateInvoice(order._id.toString())
    .then(invoiceResult => {
      if (mailService && mailService.sendInvoiceEmail) {
        mailService.sendInvoiceEmail({
          customerName: customer.name,
          customerEmail: customer.email,
          invoiceNumber: invoiceResult.invoice.invoiceNumber,
          pdfPath: invoiceResult.pdfPath
        }).catch(err => console.error('Invoice email send failed:', err));
      }
    })
    .catch(err => console.error('Invoice generation failed:', err));

  if (mailService && mailService.sendOrderConfirmation) {
    mailService.sendOrderConfirmation({
      customerName: customer.name,
      customerEmail: customer.email,
      customerPhone: order.shippingAddress?.phone || customer.phone || 'N/A',
      orderId: order._id.toString(),
      orderDate: order.createdAt,
      items: order.items.map(it => ({
        productName: it.name,
        name: it.name,
        productImage: it.image || it.productImage,
        productDescription: it.description || it.productDescription,
        size: it.size,
        color: it.color,
        quantity: it.quantity,
        price: it.price
      })),
      totalAmount: order.total,
      shippingAddress: order.shippingAddress,
      paymentMethod: paymentLabel
    }).catch(err => console.error('Customer email send failed:', err));
  }

  if (deliveryInfo?.managers?.length > 0) {
    for (const manager of deliveryInfo.managers) {
      if (mailService && mailService.sendManagerOrderNotification) {
        mailService.sendManagerOrderNotification({
          managerName: manager.name,
          managerEmail: manager.email,
          customerName: customer.name,
          customerPhone: order.shippingAddress?.phone || customer.phone || 'N/A',
          orderId: order._id.toString(),
          orderDate: order.createdAt,
          items: order.items.map(it => ({
            name: it.name,
            quantity: it.quantity,
            price: it.price,
            productImage: it.image || it.productImage || '',
            productUrl: it.product ? `/product/${it.product.toString()}` : ''
          })),
          totalAmount: order.total,
          shippingAddress: order.shippingAddress,
          zoneName: deliveryInfo.zone?.name,
          paymentMethod: paymentLabel
        }).catch(err => console.error('Manager email send failed:', err));
      }
    }
  }

  notificationService.createNewOrderNotifications({
    order,
    deliveryInfo,
    customerName: customer.name
  }).catch(err => console.error('Notification persistence failed:', err));

  if (notifyStaffPush) {
    pushService.notifyNewOrder({
      orderId: order._id.toString(),
      customerName: customer.name,
      total: order.total,
      itemCount: order.items.length,
      isTrial: order.isTrial || false,
      paymentMethod: 'COD'
    }).catch(err => console.error('Push notification send failed:', err));
  }

  // Idempotent on its own (one-shot flag on the order).
  pushService.notifyCustomerOrderConfirmed(order)
    .catch(err => console.error('Customer push notification send failed:', err));

  // Trial & Buy: create/sync the TrialOrder record
  if (order.isTrial && Array.isArray(order.trialItems) && order.trialItems.length > 0) {
    try {
      const TrialOrder = require('../models/TrialOrder');
      const purchasedProd = order.items[0];
      const purchasedPrice = (purchasedProd?.price || 0) * (purchasedProd?.quantity || 1);
      const itemsTotal = Math.round(purchasedPrice * 100) / 100;
      const finalTotal = Math.round((purchasedPrice + (order.trialFee || 0)) * 100) / 100;

      const trialOrder = await TrialOrder.findOne({ linkedOrderId: order._id });
      if (!trialOrder) {
        await TrialOrder.create({
          userId: customer._id || order.customer,
          trialItems: order.trialItems.map(ti => ({
            product: ti.product,
            name: ti.name,
            price: ti.price,
            image: ti.image,
            size: ti.size || 'M',
            quantity: ti.quantity || 1
          })),
          purchasedItemId: purchasedProd?.product || purchasedProd?._id,
          itemsTotal,
          trialFee: order.trialFee || 0,
          finalTotal,
          status: 'converted_to_order',
          linkedOrderId: order._id,
          convertedAt: new Date()
        });
      } else {
        trialOrder.status = 'converted_to_order';
        trialOrder.itemsTotal = itemsTotal;
        trialOrder.finalTotal = finalTotal;
        trialOrder.convertedAt = new Date();
        await trialOrder.save();
      }
    } catch (tErr) {
      console.error('Error syncing TrialOrder record:', tErr);
    }
  }
}

exports.runOrderConfirmedEffects = runOrderConfirmedEffects;

/**
 * Verify Razorpay payment signature and finalize order
 * Called by the app after a successful payment. Idempotent, and safe to race
 * with the Razorpay webhook: both go through orderLifecycle.confirmPaidOrder.
 */
exports.verifyPayment = async (req, res, next) => {
  try {
    const { razorpayPaymentId, razorpaySignature } = req.body || {};
    const orderId = req.body?.orderId || req.params.id;

    if (!orderId || !razorpayPaymentId || !razorpaySignature ||
        typeof razorpayPaymentId !== 'string' || typeof razorpaySignature !== 'string') {
      return res.status(400).json({ error: 'Missing payment details' });
    }
    if (!mongoose.Types.ObjectId.isValid(String(orderId))) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const existing = await Order.findById(orderId).populate('customer');
    if (!existing) return res.status(404).json({ error: 'Order not found' });

    // Verify user owns this order
    if (String(existing.customer?._id || existing.customer) !== String(req.user.id)) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    if (existing.payment?.status === 'success') {
      return res.json({ message: 'Payment already verified', order: existing });
    }

    const isValid = RazorpayUtil.verifyPaymentSignature(
      existing.payment?.razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature
    );

    if (!isValid) {
      // A bad signature proves nothing either way, so the order is left untouched:
      // it must not be possible to fail (and un-reserve) an order by sending junk.
      logger.security('Invalid Razorpay signature on verify-payment', { order: String(existing._id) });
      return res.status(400).json({ error: 'Payment verification failed' });
    }

    const result = await orderLifecycle.confirmPaidOrder({ orderId: existing._id, paymentId: razorpayPaymentId });
    const order = await Order.findById(existing._id).populate('customer');

    if (result.refundRequired) {
      return res.status(409).json({
        error: 'Your payment was received but the order could not be confirmed. A refund will be issued.',
        code: 'REFUND_REQUIRED',
        order
      });
    }

    if (result.transitioned) {
      await runOrderConfirmedEffects(order, { paymentLabel: 'Online Payment' });
      return res.json({ message: 'Payment verified successfully', order });
    }

    return res.json({ message: 'Payment already verified', order });
  } catch (err) {
    return forwardControllerError(next, res, err, 'Failed to verify payment');
  }
};

/**
 * Mark payment as failed. Only ever affects an order that is still awaiting
 * payment; an order that was already paid is returned unchanged.
 */
exports.markPaymentFailed = async (req, res, next) => {
  try {
    const orderId = req.body?.orderId || req.params.id;
    if (!orderId || !mongoose.Types.ObjectId.isValid(String(orderId))) {
      return res.status(404).json({ error: 'Order not found' });
    }
    const existing = await Order.findById(orderId);
    if (!existing) return res.status(404).json({ error: 'Order not found' });
    if (String(existing.customer) !== String(req.user.id)) return res.status(403).json({ error: 'Unauthorized' });

    const result = await orderLifecycle.failPendingOrder({ orderId: existing._id, reason: 'reported_by_client' });
    const order = result.order || existing;

    if (result.transitioned) {
      pushService.notifyCustomerPaymentFailed(order)
        .catch(err => console.error('Customer push notification send failed:', err));
    }
    res.json({ success: true, message: 'Order payment marked as failed', order });
  } catch (err) {
    return forwardControllerError(next, res, err);
  }
};

exports.get = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id).populate('customer').populate('items.product');
    if (!order) return res.status(404).json({ error: 'Not found' });

    const roles = req.user.roles || [];
    const isAdminOrManager = roles.includes('admin') || roles.includes('manager');

    if (String(order.customer?._id || order.customer) !== String(req.user.id) && !isAdminOrManager) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.json(order);
  } catch (err) {
    return forwardControllerError(next, res, err);
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
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const sort = ['createdAt', '-createdAt', 'total', '-total'].includes(req.query.sort) ? req.query.sort : '-createdAt';
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const skip = (page - 1) * limit;

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
    return forwardControllerError(next, res, err);
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

    const existingOrder = await Order.findById(req.params.id).select('status');
    if (!existingOrder) return res.status(404).json({ error: 'Order not found' });
    const previousStatus = existingOrder.status;

    const order = await Order.findByIdAndUpdate(
      req.params.id,
      {
        status,
        ...(trackingNumber && { trackingNumber })
      },
      { returnDocument: 'after' }
    ).populate('customer');

    if (!order) return res.status(404).json({ error: 'Order not found' });

    // Staff cancelled / failed the order: give back its stock and voucher use, and
    // list it for a manual refund if the customer had already paid online.
    if (['cancelled', 'failed'].includes(status) && !['cancelled', 'failed'].includes(previousStatus)) {
      await orderLifecycle.handleStaffCancellation(order._id);
    }

    pushService.notifyCustomerOrderStatusChange(order, previousStatus, status)
      .catch(err => console.error('Customer push notification send failed:', err));

    res.json({ message: 'Order status updated', order });
  } catch (err) {
    return forwardControllerError(next, res, err);
  }
};

/**
 * Cancel order and release stock (admin or customer)
 */
exports.cancel = async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(String(req.params.id))) {
      return res.status(404).json({ error: 'Order not found' });
    }
    const existing = await Order.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Order not found' });

    // Check authorization
    const isOwner = String(existing.customer) === String(req.user.id);
    const isAdmin = req.user.roles && req.user.roles.includes('admin');

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const result = await orderLifecycle.cancelOrder({ orderId: existing._id });
    if (!result.transitioned) {
      return res.status(400).json({ error: `Cannot cancel order with status: ${result.order?.status || existing.status}` });
    }

    const order = await Order.findById(existing._id).populate('customer');

    pushService.notifyCustomerOrderStatusChange(order, result.previousStatus, 'cancelled')
      .catch(err => console.error('Customer push notification send failed:', err));

    res.json({ message: 'Order cancelled successfully', order });
  } catch (err) {
    return forwardControllerError(next, res, err);
  }
};

/**
 * Mark COD payment as collected (admin/manager only)
 */
exports.markCodCollected = async (req, res, next) => {
  try {
    const roles = req.user.roles || [];
    const isAdminOrManager = roles.includes('admin') || roles.includes('manager');
    if (!isAdminOrManager) {
      return res.status(403).json({ error: 'Admin or manager access required' });
    }

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    if (order.payment?.method !== 'cod') {
      return res.status(400).json({ error: 'This order is not a Cash on Delivery order' });
    }

    if (order.payment?.status === 'cod_collected') {
      return res.json({ message: 'COD payment already marked as collected', order });
    }

    order.payment.status = 'cod_collected';
    order.payment.transactionId = `COD_${Date.now()}`;
    await order.save();

    console.log(`✅ COD payment collected for order ${order._id}`);
    res.json({ message: 'COD payment marked as collected', order });
  } catch (err) {
    return forwardControllerError(next, res, err);
  }
};

module.exports = exports;
