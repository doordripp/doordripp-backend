/**
 * Trial Room Controller
 * 
 * Handles all trial room operations:
 * - Create trial order with validations
 * - Daily usage check
 * - Convert trial to order
 * - Get trial history
 * - List all trials (admin)
 * - Analytics
 * 
 * @module controllers/trialRoomController
 */

const TrialOrder = require('../models/TrialOrder');
const logger = require('../utils/logger');
const User = require('../models/User');
const Product = require('../models/Product');

/**
 * Validation constants
 */
const TRIAL_CONSTANTS = {
  MAX_ITEMS: 3,
  MIN_ITEMS: 2,
  TRIAL_FEE: 0
};

/**
 * Get today's date at start of day (00:00:00)
 * @returns {Date}
 */
const getTodayStart = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
};

/**
 * Get today's date at end of day (23:59:59)
 * @returns {Date}
 */
const getTodayEnd = () => {
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  return today;
};

/**
 * Helper: Validate trial items format
 * @param {Array} items - Trial items from request
 * @throws {Error}
 */
const validateTrialItems = (items) => {
  if (!Array.isArray(items)) {
    throw new Error('Trial items must be an array');
  }

  if (items.length < TRIAL_CONSTANTS.MIN_ITEMS) {
    throw new Error(`Minimum ${TRIAL_CONSTANTS.MIN_ITEMS} item required for trial`);
  }

  if (items.length > TRIAL_CONSTANTS.MAX_ITEMS) {
    throw new Error(`Maximum ${TRIAL_CONSTANTS.MAX_ITEMS} items allowed for trial`);
  }

  // Validate each item has required fields
  items.forEach((item, index) => {
    if (!item.productId) {
      throw new Error(`Trial item ${index + 1}: productId is required`);
    }
    if (!item.name) {
      throw new Error(`Trial item ${index + 1}: name is required`);
    }
    if (typeof item.price !== 'number' || item.price < 0) {
      throw new Error(`Trial item ${index + 1}: valid price is required`);
    }
  });

  // Check for duplicate products
  const productIds = items.map(i => i.productId.toString());
  const uniqueIds = new Set(productIds);
  if (uniqueIds.size !== productIds.length) {
    throw new Error('Duplicate items not allowed in trial room');
  }
};

/**
 * Helper: Validate purchased item
 * @param {String} purchasedItemId - Product ID to be purchased
 * @param {Array} trialItems - Trial items array
 * @throws {Error}
 */
const validatePurchasedItem = (purchasedItemId, trialItems) => {
  if (!purchasedItemId) {
    throw new Error('Purchased item ID is required');
  }

  const isPurchasedInTrial = trialItems.some(
    item => item.productId.toString() === purchasedItemId.toString()
  );

  if (!isPurchasedInTrial) {
    throw new Error('Purchased item must be one of the selected trial items');
  }
};

/**
 * POST /api/trial-room/create
 * 
 * Create a new trial order with comprehensive validations
 * 
 * Request body:
 * {
 *   trialItems: [
 *     { productId, name, price, image, quantity },
 *     ...
 *   ],
 *   purchasedItemId: ObjectId
 * }
 * 
 * Response:
 * {
 *   success: boolean,
 *   message: string,
 *   data: TrialOrder,
 *   breakdown: { itemsTotal, trialFee, finalTotal }
 * }
 */
exports.createTrialOrder = async (req, res) => {
  try {
    const userId = req.user._id;
    const { trialItems, purchasedItemId } = req.body;

    logger.info('Creating trial order:', {
      userId,
      trialItemsCount: trialItems?.length,
      purchasedItemId,
      trialItems
    });

    // ============ VALIDATION LAYER ============

    // 1. Validate trial items format
    validateTrialItems(trialItems);

    // 2. Validate purchased item
    validatePurchasedItem(purchasedItemId, trialItems);

    // 3. Check if user already used trial today - TEMPORARILY DISABLED FOR TESTING
    // const hasUsedTodayAlready = await TrialOrder.countDocuments({
    //   userId,
    //   createdAt: {
    //     $gte: getTodayStart(),
    //     $lte: getTodayEnd()
    //   },
    //   status: { $ne: 'cancelled' }
    // });

    // if (hasUsedTodayAlready > 0) {
    //   return res.status(429).json({
    //     success: false,
    //     message: 'Trial Room can be used once per day. Try again tomorrow!',
    //     code: 'TRIAL_DAILY_LIMIT_EXCEEDED',
    //     nextAvailableDate: new Date(getTodayEnd().getTime() + 1000)
    //   });
    // }

    // 4. Verify all products exist and get current prices
    const productIds = trialItems.map(item => item.productId);
    const products = await Product.find({ _id: { $in: productIds } });

    if (products.length !== productIds.length) {
      return res.status(400).json({
        success: false,
        message: 'One or more products not found',
        code: 'PRODUCT_NOT_FOUND'
      });
    }

    // 5. Create formatted trial items with database prices
    const formattedTrialItems = trialItems.map(item => {
      const product = products.find(p => p._id.toString() === item.productId.toString());
      return {
        product: product._id,
        name: product.name,
        price: product.price,
        image: product.images && product.images[0] ? product.images[0] : null,
        quantity: item.quantity || 1,
        size: item.size || 'M'
      };
    });

    // 6. Calculate totals strictly for the purchased item (Trial & Buy pays for selected item only)
    const purchasedProduct = products.find(p => p._id.toString() === purchasedItemId.toString());
    const purchasedTrialItem = trialItems.find(item => item.productId.toString() === purchasedItemId.toString());
    const purchasedQty = purchasedTrialItem?.quantity || 1;
    const itemsTotal = (purchasedProduct ? purchasedProduct.price : 0) * purchasedQty;

    const finalTotal = itemsTotal + TRIAL_CONSTANTS.TRIAL_FEE;

    // ============ CREATE TRIAL ORDER ============

    const trialOrder = new TrialOrder({
      userId,
      trialItems: formattedTrialItems,
      purchasedItemId,
      itemsTotal: Math.round(itemsTotal * 100) / 100, // Round to 2 decimals
      trialFee: TRIAL_CONSTANTS.TRIAL_FEE,
      finalTotal: Math.round(finalTotal * 100) / 100,
      status: 'trial_created'
    });

    // Validate and save
    await trialOrder.validate();
    await trialOrder.save();

    // ============ UPDATE USER - SET LAST TRIAL DATE ============
    await User.findByIdAndUpdate(userId, {
      lastTrialDate: new Date()
    });

    // ============ SUCCESS RESPONSE ============
    res.status(201).json({
      success: true,
      message: 'Trial room created successfully',
      data: trialOrder,
      breakdown: {
        itemsCount: formattedTrialItems.length,
        itemsTotal: trialOrder.itemsTotal,
        trialFee: TRIAL_CONSTANTS.TRIAL_FEE,
        finalTotal: trialOrder.finalTotal
      }
    });

  } catch (error) {
    logger.error('Trial Room Creation Error:', error);
    logger.error('Error details:', {
      name: error.name,
      message: error.message,
      stack: error.stack
    });
    
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: Object.values(error.errors).map(e => e.message),
        code: 'VALIDATION_ERROR'
      });
    }

    res.status(500).json({
      success: false,
      message: error.message || 'Failed to create trial order',
      code: 'TRIAL_CREATION_ERROR'
    });
  }
};

/**
 * GET /api/trial-room/check-today
 * 
 * Check if user has already used trial today
 * 
 * Response:
 * {
 *   hasUsedToday: boolean,
 *   message: string,
 *   nextAvailableDate?: Date
 * }
 */
exports.checkDailyUsage = async (req, res) => {
  try {
    // Daily limit removed — users can use trial room multiple times per day
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.json({
      success: true,
      hasUsedToday: false,
      message: 'Trial room available',
      nextAvailableDate: null
    });

  } catch (error) {
    logger.error('Check Daily Usage Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check trial status',
      code: 'CHECK_STATUS_ERROR'
    });
  }
};

/**
 * GET /api/trial-room/history
 * 
 * Get user's trial history with pagination
 * 
 * Query params:
 * - page (default: 1)
 * - limit (default: 10)
 * - status (optional filter: trial_created, converted_to_order, etc.)
 * 
 * Response:
 * {
 *   success: boolean,
 *   data: TrialOrder[],
 *   pagination: { page, limit, total, pages }
 * }
 */
exports.getTrialHistory = async (req, res) => {
  try {
    const userId = req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const status = req.query.status;

    const skip = (page - 1) * limit;
    const filter = { userId };

    if (status) {
      filter.status = status;
    }

    const [trials, total] = await Promise.all([
      TrialOrder.find(filter)
        .populate('userId', 'name email phone')
        .populate('trialItems.product', 'name price image images')
        .populate('purchasedItemId', 'name price image images')
        .populate('linkedOrderId')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      TrialOrder.countDocuments(filter)
    ]);

    res.json({
      success: true,
      data: trials,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    logger.error('Get Trial History Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch trial history',
      code: 'FETCH_HISTORY_ERROR'
    });
  }
};

/**
 * GET /api/trial-room/:id
 * 
 * Get specific trial order details
 * 
 * Response:
 * {
 *   success: boolean,
 *   data: TrialOrder
 * }
 */
exports.getTrialOrder = async (req, res) => {
  try {
    const trialId = req.params.id;
    const userId = req.user._id;

    const trial = await TrialOrder.findOne({
      _id: trialId,
      userId
    })
      .populate('userId', 'name email phone')
      .populate('trialItems.product')
      .populate('purchasedItemId')
      .populate('linkedOrderId');

    if (!trial) {
      return res.status(404).json({
        success: false,
        message: 'Trial order not found',
        code: 'TRIAL_NOT_FOUND'
      });
    }

    res.json({
      success: true,
      data: trial
    });

  } catch (error) {
    logger.error('Get Trial Order Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch trial order',
      code: 'FETCH_TRIAL_ERROR'
    });
  }
};

/**
 * POST /api/trial-room/:id/convert
 * 
 * Convert trial order to actual order
 * This is called after successful payment
 * 
 * Request body:
 * {
 *   orderId: ObjectId // The created order ID after payment
 * }
 */
exports.convertTrialToOrder = async (req, res) => {
  try {
    const trialId = req.params.id;
    const userId = req.user._id;
    const { orderId } = req.body;

    const trial = await TrialOrder.findOne({
      _id: trialId,
      userId
    });

    if (!trial) {
      return res.status(404).json({
        success: false,
        message: 'Trial order not found',
        code: 'TRIAL_NOT_FOUND'
      });
    }

    if (trial.status === 'converted_to_order') {
      return res.status(400).json({
        success: false,
        message: 'Trial already converted',
        code: 'TRIAL_ALREADY_CONVERTED'
      });
    }

    // Convert trial to order
    await trial.convertToOrder(orderId);

    res.json({
      success: true,
      message: 'Trial converted to order successfully',
      data: trial
    });

  } catch (error) {
    logger.error('Convert Trial Error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to convert trial',
      code: 'CONVERT_ERROR'
    });
  }
};

/**
 * POST /api/trial-room/:id/cancel
 * 
 * Cancel a trial order
 */
exports.cancelTrialOrder = async (req, res) => {
  try {
    const trialId = req.params.id;
    const userId = req.user._id;

    const trial = await TrialOrder.findOne({
      _id: trialId,
      userId
    });

    if (!trial) {
      return res.status(404).json({
        success: false,
        message: 'Trial order not found',
        code: 'TRIAL_NOT_FOUND'
      });
    }

    await trial.cancel();

    res.json({
      success: true,
      message: 'Trial cancelled successfully',
      data: trial
    });

  } catch (error) {
    logger.error('Cancel Trial Error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to cancel trial',
      code: 'CANCEL_ERROR'
    });
  }
};

/**
 * ============ ADMIN ENDPOINTS ============
 */

/**
 * GET /api/trial-room/admin/list
 * 
 * List all trial orders (Admin only)
 */
exports.adminListTrials = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const status = req.query.status;
    const skip = (page - 1) * limit;

    const filter = {};
    if (status) {
      filter.status = status;
    }

    const [trials, total] = await Promise.all([
      TrialOrder.find(filter)
        .populate('userId', 'name email phone')
        .populate('trialItems.product', 'name price')
        .populate('purchasedItemId', 'name price')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      TrialOrder.countDocuments(filter)
    ]);

    res.json({
      success: true,
      data: trials,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    logger.error('Admin List Trials Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch trials',
      code: 'FETCH_ERROR'
    });
  }
};

/**
 * GET /api/trial-room/admin/analytics
 * 
 * Get trial room analytics
 */
exports.adminGetAnalytics = async (req, res) => {
  try {
    const today = getTodayStart();
    const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const thisYear = new Date(today.getFullYear(), 0, 1);

    const [
      totalTrials,
      todayTrials,
      monthTrials,
      yearTrials,
      convertedTrials,
      totalRevenue,
      mostTrialedItems
    ] = await Promise.all([
      TrialOrder.countDocuments(),
      TrialOrder.countDocuments({
        createdAt: { $gte: today }
      }),
      TrialOrder.countDocuments({
        createdAt: { $gte: thisMonth }
      }),
      TrialOrder.countDocuments({
        createdAt: { $gte: thisYear }
      }),
      TrialOrder.countDocuments({
        status: 'converted_to_order'
      }),
      TrialOrder.aggregate([
        { $match: { status: 'converted_to_order' } },
        { $group: { _id: null, total: { $sum: '$finalTotal' } } }
      ]),
      TrialOrder.aggregate([
        { $unwind: '$trialItems' },
        { $group: {
          _id: '$trialItems.product',
          count: { $sum: 1 }
        }},
        { $sort: { count: -1 } },
        { $limit: 10 },
        { $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: '_id',
          as: 'product'
        }}
      ])
    ]);

    const conversionRate = totalTrials > 0 
      ? Math.round((convertedTrials / totalTrials) * 100 * 100) / 100 
      : 0;

    res.json({
      success: true,
      data: {
        totalTrials,
        todayTrials,
        monthTrials,
        yearTrials,
        convertedTrials,
        conversionRate: `${conversionRate}%`,
        totalRevenue: totalRevenue.length > 0 ? totalRevenue[0].total : 0,
        mostTrialedItems: mostTrialedItems.map(item => ({
          productId: item._id,
          productName: item.product[0]?.name,
          trialCount: item.count
        }))
      }
    });

  } catch (error) {
    logger.error('Admin Analytics Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch analytics',
      code: 'ANALYTICS_ERROR'
    });
  }
};

module.exports = exports;
