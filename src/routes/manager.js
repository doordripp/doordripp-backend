const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Order = require('../models/Order');
const bcrypt = require('bcryptjs');
const adminController = require('../controllers/mongoAdminController');
const { verifyToken, requireAnyRole } = require('../middleware/auth');

const DEFAULT_MAX_ORDERS_PER_SLOT = 10;
const ACTIVE_ASSIGNED_ORDER_STATUSES = ['pending', 'confirmed', 'packed', 'processing', 'shipped'];

const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildActiveAssignedOrdersQuery = (partnerId) => ({
  status: { $in: ACTIVE_ASSIGNED_ORDER_STATUSES },
  $or: [
    { assignedDeliveryPartner: partnerId },
    { 'deliveryPartner.id': partnerId },
    { 'deliveryPartner.riderId': partnerId }
  ]
});

const syncPartnerMetrics = async (partner, preloadedOrders = null, { persist = false } = {}) => {
  if (!partner) return { partner: null, orders: [] };

  const orders = preloadedOrders || await Order.find(buildActiveAssignedOrdersQuery(partner._id))
    .populate('customer', 'name email phone')
    .sort({ createdAt: -1 });

  const partnerObject = typeof partner.toObject === 'function' ? partner.toObject() : { ...partner };
  const deliveryPartner = partnerObject.deliveryPartner || {};
  const activeLoad = orders.length;
  const normalizedCapacity = Math.max(Number(deliveryPartner.maxOrdersPerSlot) || 0, DEFAULT_MAX_ORDERS_PER_SLOT);
  const currentLoad = Number(deliveryPartner.currentLoad) || 0;

  partnerObject.deliveryPartner = {
    ...deliveryPartner,
    currentLoad: activeLoad,
    maxOrdersPerSlot: normalizedCapacity
  };

  if (persist && (currentLoad !== activeLoad || (Number(deliveryPartner.maxOrdersPerSlot) || 0) !== normalizedCapacity)) {
    await User.updateOne(
      { _id: partner._id },
      {
        $set: {
          'deliveryPartner.currentLoad': activeLoad,
          'deliveryPartner.maxOrdersPerSlot': normalizedCapacity
        }
      }
    );
  }

  return { partner: partnerObject, orders };
};

const resolveOrderIdInput = async (rawOrderId) => {
  const normalizedOrderId = String(rawOrderId || '').trim().replace(/^#/, '');
  if (!normalizedOrderId) return null;

  if (/^[a-f0-9]{24}$/i.test(normalizedOrderId)) {
    const existing = await Order.exists({ _id: normalizedOrderId });
    return existing ? normalizedOrderId : null;
  }

  const matches = await Order.aggregate([
    {
      $addFields: {
        __idString: { $toString: '$_id' }
      }
    },
    {
      $match: {
        $expr: {
          $regexMatch: {
            input: { $toUpper: '$__idString' },
            regex: `${escapeRegex(normalizedOrderId.toUpperCase())}$`
          }
        }
      }
    },
    { $project: { _id: 1 } },
    { $limit: 2 }
  ]);

  if (matches.length > 1) {
    throw new Error('Multiple orders matched this Order ID. Use the full order ID.');
  }

  return matches[0]?._id?.toString() || null;
};

// All manager routes require authentication
router.use(verifyToken);

// ==================== SELF-SERVICE (any authenticated user) ====================

/**
 * GET /api/manager/delivery-partners/me/schedule
 */
router.get('/delivery-partners/me/schedule', async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select('deliveryPartner roles');
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (Array.isArray(user.roles) && user.roles.includes('delivery_partner')) {
      const synced = await syncPartnerMetrics(user, null, { persist: true });
      user.deliveryPartner = synced.partner?.deliveryPartner || user.deliveryPartner;
    }

    res.json({
      deliveryPartner: user.deliveryPartner || {
        workingHours: '9 AM - 5 PM',
        maxOrdersPerSlot: DEFAULT_MAX_ORDERS_PER_SLOT,
        currentLoad: 0,
        availabilitySlots: ['Morning 9-12', 'Afternoon 12-4', 'Evening 4-8']
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/manager/delivery-partners/me/schedule
 */
router.put('/delivery-partners/me/schedule', async (req, res, next) => {
  try {
    const { workingHours, maxOrdersPerSlot, availabilitySlots } = req.body;

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (!user.deliveryPartner) user.deliveryPartner = {};
    if (workingHours !== undefined) user.deliveryPartner.workingHours = workingHours;
    if (maxOrdersPerSlot !== undefined) user.deliveryPartner.maxOrdersPerSlot = Math.max(Number(maxOrdersPerSlot) || DEFAULT_MAX_ORDERS_PER_SLOT, DEFAULT_MAX_ORDERS_PER_SLOT);
    if (availabilitySlots !== undefined) user.deliveryPartner.availabilitySlots = availabilitySlots;

    await user.save();
    if (Array.isArray(user.roles) && user.roles.includes('delivery_partner')) {
      const synced = await syncPartnerMetrics(user, null, { persist: true });
      user.deliveryPartner = synced.partner?.deliveryPartner || user.deliveryPartner;
    }

    res.json({ success: true, message: 'Schedule updated', deliveryPartner: user.deliveryPartner });
  } catch (err) {
    next(err);
  }
});

// ==================== ADMIN/MANAGER ROUTES ====================
router.use(requireAnyRole('admin', 'manager'));

/**
 * GET /api/manager/delivery-partners
 */
router.get('/delivery-partners', async (req, res, next) => {
  try {
    const { search } = req.query;
    const query = { roles: 'delivery_partner' };

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } }
      ];
    }

    const partners = await User.find(query)
      .select('-password -refreshToken')
      .sort({ createdAt: -1 });

    const syncedPartners = await Promise.all(
      partners.map(async (partner) => (await syncPartnerMetrics(partner, null, { persist: true })).partner)
    );

    res.json({ success: true, users: syncedPartners });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/manager/delivery-partners
 */
router.post('/delivery-partners', async (req, res, next) => {
  try {
    const { name, email, password, phone, vehicleType, licenseNumber, accountNumber, assignedArea } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: 'Name, email, and password are required' });
    }

    const emailNorm = email.toLowerCase().trim();
    const existing = await User.findOne({ email: emailNorm });
    
    if (existing) {
      if (!existing.roles.includes('delivery_partner')) {
        existing.roles.push('delivery_partner');
      }
      
      // Update fields even if user exists
      existing.name = name.trim();
      if (phone) existing.phone = phone.trim();
      
      existing.deliveryPartner = {
        ...existing.deliveryPartner,
        maxOrdersPerSlot: Math.max(Number(existing.deliveryPartner?.maxOrdersPerSlot) || 0, DEFAULT_MAX_ORDERS_PER_SLOT),
        vehicleType: vehicleType || existing.deliveryPartner?.vehicleType || 'Bike',
        licenseNumber: licenseNumber || existing.deliveryPartner?.licenseNumber || '',
        accountNumber: accountNumber || existing.deliveryPartner?.accountNumber || ''
      };

      if (assignedArea) {
        existing.deliveryPartner.assignedArea = assignedArea;
      }

      await existing.save();
      return res.json({ 
        success: true, 
        message: 'Delivery partner details updated for existing user', 
        user: { _id: existing._id, name: existing.name, email: existing.email, roles: existing.roles } 
      });
    }

    const user = new User({
      name: name.trim(),
      email: emailNorm,
      password,
      phone: phone || undefined,
      roles: ['delivery_partner'],
      emailVerified: true,
      termsAccepted: true,
      isPasswordSet: true,
      deliveryPartner: {
        maxOrdersPerSlot: DEFAULT_MAX_ORDERS_PER_SLOT,
        vehicleType: vehicleType || 'Bike',
        licenseNumber: licenseNumber || '',
        accountNumber: accountNumber || '',
        assignedArea: assignedArea || null
      }
    });

    await user.save();

    res.status(201).json({
      success: true,
      message: 'Delivery partner created successfully',
      user: { _id: user._id, name: user.name, email: user.email, phone: user.phone, roles: user.roles }
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ success: false, error: 'Email or phone already exists' });
    }
    next(err);
  }
});

/**
 * GET /api/manager/delivery-partners/:id
 */
router.get('/delivery-partners/:id', async (req, res, next) => {
  try {
    const partner = await User.findById(req.params.id).select('-password -refreshToken');
    if (!partner) return res.status(404).json({ success: false, error: 'Partner not found' });
    
    const { partner: syncedPartner, orders } = await syncPartnerMetrics(partner, null, { persist: true });
    res.json({ success: true, user: syncedPartner, orders });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/manager/delivery-partners/:id
 */
router.put('/delivery-partners/:id', async (req, res, next) => {
  try {
    const { name, email, phone, deliveryPartner } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, error: 'Partner not found' });

    if (name) user.name = name;
    if (email) user.email = email.toLowerCase().trim();
    if (phone !== undefined) user.phone = phone;
    
    if (deliveryPartner) {
      user.deliveryPartner = {
        ...user.deliveryPartner,
        ...deliveryPartner,
        maxOrdersPerSlot: Math.max(Number(deliveryPartner.maxOrdersPerSlot ?? user.deliveryPartner?.maxOrdersPerSlot) || DEFAULT_MAX_ORDERS_PER_SLOT, DEFAULT_MAX_ORDERS_PER_SLOT)
      };
    }

    await user.save();
    res.json({ success: true, message: 'Partner details updated', user });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/manager/delivery-partners/:id
 */
router.delete('/delivery-partners/:id', async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, error: 'Partner not found' });

    // Just remove the delivery_partner role and clear details
    user.roles = user.roles.filter(r => r !== 'delivery_partner');
    user.deliveryPartner = undefined;
    
    // If user has no more roles, maybe delete? But user said "delete that delivery partner", 
    // usually means remove their ability to deliver. 
    // If they want full deletion:
    if (user.roles.length === 0) {
      await User.findByIdAndDelete(req.params.id);
    } else {
      await user.save();
    }

    res.json({ success: true, message: 'Delivery partner removed successfully' });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/manager/delivery-partners/:id/assign-order
 */
router.post('/delivery-partners/:id/assign-order', async (req, res, next) => {
  try {
    const partnerId = req.params.id;
    const resolvedOrderId = await resolveOrderIdInput(req.body.orderId);

    if (!resolvedOrderId) {
      return res.status(404).json({ ok: false, error: 'Order not found for the provided Order ID' });
    }

    req.params = { ...req.params, id: resolvedOrderId };
    req.body = { ...req.body, deliveryPartnerId: partnerId };
    return adminController.assignDeliveryPartner(req, res, next);
  } catch (err) {
    if (err.message?.includes('Multiple orders matched')) {
      return res.status(400).json({ ok: false, error: err.message });
    }
    return next(err);
  }
});

/**
 * DELETE /api/manager/delivery-partners/:id/unassign-order/:orderId
 */
router.delete('/delivery-partners/:id/unassign-order/:orderId', async (req, res, next) => {
  req.params = { ...req.params, id: req.params.orderId };
  return adminController.unassignDeliveryPartner(req, res, next);
});

module.exports = router;
