const Order = require('../models/Order');
const Product = require('../models/Product');
const RazorpayUtil = require('../utils/razorpay');
const mailService = require('../services/mail.service');
const pushService = require('../services/pushNotification.service');
const notificationService = require('../services/notification.service');
const DeliveryZone = require('../models/DeliveryZone');
const AreaManager = require('../models/AreaManager');
const voucherService = require('../services/voucher.service');
const { getDeliveryChargeConfig, pickDeliveryOption } = require('../utils/deliveryChargeConfig');
const { normalizeSizeInventory, getDefaultSize, normalizeSizeLabel, getTotalStock } = require('../utils/productInventory');

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

const adjustProductSizeStock = async (productId, size, quantityDelta) => {
  const product = await Product.findById(productId);
  if (!product) return null;

  const normalizedInventory = normalizeSizeInventory(product.sizeInventory, product.sizes, product.stock);
  const fallbackSize = getDefaultSize(normalizedInventory, product.sizes);
  const targetSize = normalizeSizeLabel(size || fallbackSize);
  const nextInventory = normalizedInventory.map((entry) => {
    if (entry.size !== targetSize) return entry;
    return {
      ...entry,
      stock: Math.max(0, Number(entry.stock || 0) + Number(quantityDelta || 0))
    };
  });

  if (!nextInventory.some((entry) => entry.size === targetSize)) {
    nextInventory.push({
      size: targetSize,
      stock: Math.max(0, Number(quantityDelta || 0))
    });
  }

  product.sizeInventory = nextInventory;
  product.sizes = nextInventory.map((entry) => entry.size);
  product.stock = getTotalStock(nextInventory);
  await product.save();
  return product;
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
      trialFee = 0,
      isTrial = false,
      trialItems = [],
      voucherCode,
      paymentMethod = 'online' // 'cod' or 'online'
    } = req.body;
    if (!items || !items.length) return res.status(400).json({ error: 'No items' });

    const isCOD = paymentMethod === 'cod';
    const parsedTrialFee = Number(trialFee);
    const safeTrialFee = Number.isFinite(parsedTrialFee) && parsedTrialFee >= 0 ? parsedTrialFee : 0;

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

      const product = await Product.findById(it.product);
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

    // Build list of products to reserve or deduct
    const reservationList = isTrial ? trialItems : orderItems;

    // Enrich trialItems with source if present
    const enrichedTrialItems = [];
    if (isTrial && Array.isArray(trialItems)) {
      for (const ti of trialItems) {
        const pid = ti.product || ti.productId || ti._id;
        const p = await Product.findById(pid);
        enrichedTrialItems.push({
          product: pid,
          name: ti.name || p?.name,
          image: ti.image || (p?.images && p.images[0]) || p?.image,
          price: ti.price || p?.price,
          size: normalizeSizeLabel(ti.size || ti.selectedSize || getDefaultSize(p?.sizeInventory, p?.sizes)),
          productSource: p?.productSource || 'Manufacturer'
        });
      }
    }

    const roundedTotal = Math.round(total * 100) / 100;

    // --- COD vs ONLINE payment branching ---
    if (isCOD) {
      // COD: No Razorpay order needed. Confirm order immediately.
      const order = await Order.create({
        customer: req.user.id,
        items: orderItems,
        subtotal: Math.round(subtotal * 100) / 100,
        cgstTotal: Math.round(totalCGST * 100) / 100,
        sgstTotal: Math.round(totalSGST * 100) / 100,
        igstTotal: 0,
        totalGST: Math.round(totalGST * 100) / 100,
        deliveryFee,
        trialFee: safeTrialFee,
        isTrial,
        trialItems: enrichedTrialItems,
        deliveryType: resolvedDeliveryType,
        deliveryETA,
        totalBeforeDiscount,
        voucherDiscount,
        voucher,
        total: roundedTotal,
        status: 'confirmed',
        payment: {
          method: 'cod',
          status: 'cod_pending',
          codAmount: roundedTotal
        },
        shippingAddress
      });

      // Deduct size-wise stock immediately for confirmed COD orders.
      for (const it of reservationList) {
        const pid = it.product || it.productId || it._id;
        const quantity = it.quantity || 1;
        const size = it.size || it.selectedSize;
        await adjustProductSizeStock(pid, size, -quantity);
      }

      // Consume voucher usage for COD
      if (order.voucher?.voucherId && !order.voucher?.usageApplied) {
        await voucherService.consumeVoucherUsage({
          voucherId: order.voucher.voucherId,
          userId: req.user.id
        });
        order.voucher.usageApplied = true;
        await order.save();
      }

      // Populate customer for notifications
      await order.populate('customer');

      // Auto-assign delivery partner (non-blocking)
      const deliveryInfo = await autoAssignDeliveryPartner(order);

      // Generate invoice (non-blocking)
      const InvoiceService = require('../services/invoiceService');
      InvoiceService.generateInvoice(order._id.toString())
        .then(invoiceResult => {
          console.log(`✅ COD Invoice generated: ${invoiceResult.invoice.invoiceNumber}`);
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

      // Send confirmation email (non-blocking)
      if (mailService && mailService.sendOrderConfirmation) {
        mailService.sendOrderConfirmation({
          customerName: order.customer.name,
          customerEmail: order.customer.email,
          customerPhone: order.shippingAddress?.phone || order.customer.phone || 'N/A',
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
          paymentMethod: 'Cash on Delivery'
        }).catch(err => console.error('Customer email send failed:', err));
      }

      // Manager notifications (non-blocking)
      if (deliveryInfo?.managers?.length > 0) {
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
                price: it.price,
                productImage: it.image || it.productImage || '',
                productUrl: it.product ? `/product/${it.product.toString()}` : ''
              })),
              totalAmount: order.total,
              shippingAddress: order.shippingAddress,
              zoneName: deliveryInfo.zone?.name,
              paymentMethod: 'Cash on Delivery'
            }).catch(err => console.error('Manager email send failed:', err));
          }
        }
      }

      // Notification persistence
      notificationService.createNewOrderNotifications({
        order,
        deliveryInfo,
        customerName: order.customer.name
      }).catch(err => console.error('Notification persistence failed:', err));

      // Push notification
      pushService.notifyNewOrder({
        orderId: order._id.toString(),
        customerName: order.customer.name,
        total: order.total,
        itemCount: order.items.length,
        isTrial: order.isTrial || false,
        paymentMethod: 'COD'
      }).catch(err => console.error('Push notification send failed:', err));

      return res.status(201).json({
        order,
        paymentMethod: 'cod',
        pricing: {
          discountBase: discountBaseSubtotal,
          totalBeforeDiscount,
          voucherDiscount,
          payableTotal: roundedTotal
        }
      });
    }

    // --- ONLINE PAYMENT (Razorpay) ---
    const razorReceipt = `ord_${String(req.user.id).slice(-8)}_${Date.now()}`.slice(0, 40);
    const razorOrder = await RazorpayUtil.createOrder({
      amount: Math.round(total * 100),
      currency: 'INR',
      receipt: razorReceipt
    });

    const order = await Order.create({
      customer: req.user.id,
      items: orderItems,
      subtotal: Math.round(subtotal * 100) / 100,
      cgstTotal: Math.round(totalCGST * 100) / 100,
      sgstTotal: Math.round(totalSGST * 100) / 100,
      igstTotal: 0,
      totalGST: Math.round(totalGST * 100) / 100,
      deliveryFee,
      trialFee: safeTrialFee,
      isTrial,
      trialItems: enrichedTrialItems,
      deliveryType: resolvedDeliveryType,
      deliveryETA,
      totalBeforeDiscount,
      voucherDiscount,
      voucher,
      total: roundedTotal,
      status: 'pending',
      payment: { method: 'razorpay', razorpayOrderId: razorOrder.id, status: 'pending' },
      shippingAddress
    });

    res.status(201).json({
      order,
      razorOrder,
      paymentMethod: 'online',
      pricing: {
        discountBase: discountBaseSubtotal,
        totalBeforeDiscount,
        voucherDiscount,
        payableTotal: roundedTotal
      }
    });
  } catch (err) {
    if (err?.name === 'VoucherError') {
      return res.status(err.status || 400).json({ error: err.message });
    }
    if (err?.error?.description) {
      err.message = err.error.description;
    }
    return forwardControllerError(next, res, err, 'Failed to create order');
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

    const isValid = RazorpayUtil.verifyPaymentSignature(
      order.payment.razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature
    );

    if (!isValid) {
      console.error('❌ Invalid payment signature for order:', orderId);
      // Explicitly mark order as failed
      order.status = 'failed';
      order.payment.status = 'failed';
      await order.save();
      return res.status(400).json({ error: 'Payment verification failed' });
    }

    console.log('✅ Payment signature verified');

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

    // Finalize size-wise stock reduction after successful online payment.
    for (const item of order.items) {
      await adjustProductSizeStock(item.product, item.size, -item.quantity);
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
        customerPhone: order.shippingAddress?.phone || order.customer.phone || 'N/A',
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
        paymentMethod: 'Online Payment'
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
              price: it.price,
              productImage: it.image || it.productImage || '',
              productUrl: it.product ? `/product/${it.product.toString()}` : ''
            })),
            totalAmount: order.total,
            shippingAddress: order.shippingAddress,
            zoneName: deliveryInfo.zone?.name,
            paymentMethod: 'Online Payment'
          }).catch(err => console.error('Manager email send failed:', err));
        }
      }

      console.log(`✅ Order notification sent to ${managerEmails.length} manager(s) for zone: ${deliveryInfo.zone.name}`);
    } else {
      console.warn('⚠️ No managers found for this delivery area');
    }

    notificationService.createNewOrderNotifications({
      order,
      deliveryInfo,
      customerName: order.customer.name
    }).catch(err => console.error('Notification persistence failed:', err));

    // Send push notification to all admins/managers (non-blocking)
    pushService.notifyNewOrder({
      orderId: order._id.toString(),
      customerName: order.customer.name,
      total: order.total,
      itemCount: order.items.length,
      isTrial: order.isTrial || false
    }).catch(err => console.error('Push notification send failed:', err));

    res.json({ message: 'Payment verified successfully', order });
  } catch (err) {
    if (err?.name === 'VoucherError') {
      return res.status(err.status || 400).json({ error: err.message });
    }
    if (err?.error?.description) {
      err.message = err.error.description;
    }
    return forwardControllerError(next, res, err, 'Failed to verify payment');
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

      await order.save();
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

    if (String(order.customer._id) !== String(req.user.id) && !isAdminOrManager) {
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

    const order = await Order.findByIdAndUpdate(
      req.params.id,
      {
        status,
        ...(trackingNumber && { trackingNumber })
      },
      { returnDocument: 'after' }
    ).populate('customer');

    if (!order) return res.status(404).json({ error: 'Order not found' });

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

    for (const it of order.items) {
      if (order.status === 'confirmed') {
        await adjustProductSizeStock(it.product, it.size, it.quantity);
      }
    }

    order.status = 'cancelled';
    await order.save();

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
