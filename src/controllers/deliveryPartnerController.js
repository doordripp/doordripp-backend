/**
 * Delivery Partner Controller
 * Handles delivery partner specific operations:
 * - View assigned orders
 * - Update order status
 * - Order details
 */

const Order = require('../models/Order');
const User = require('../models/User');

/**
 * Get all orders assigned to the logged-in delivery partner
 * GET /api/delivery-partner/orders
 */
exports.getMyOrders = async (req, res, next) => {
  try {
    const deliveryPartnerId = req.user.id;

    // Find all orders assigned to this delivery partner
    const orders = await Order.find({
      assignedDeliveryPartner: deliveryPartnerId
    })
      .populate('customer', 'name email phone')
      .sort({ createdAt: -1 })
      .select('-deliveryUpdates -proofOfDelivery'); // Hide sensitive admin fields

    // Transform orders for delivery partner view
    const transformedOrders = orders.map(order => ({
      id: order._id,
      orderId: order._id.toString().slice(-8).toUpperCase(),
      customer: {
        name: order.customer?.name || order.shippingAddress?.name,
        phone: order.customer?.phone || order.shippingAddress?.phone
      },
      shippingAddress: order.shippingAddress,
      items: order.items,
      total: order.total,
      deliveryStatus: order.deliveryStatus,
      status: order.status,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      deliveryType: order.deliveryType,
      deliveryETA: order.deliveryETA
    }));

    res.json({
      success: true,
      orders: transformedOrders,
      count: transformedOrders.length
    });
  } catch (error) {
    console.error('[DeliveryPartner] Get orders error:', error);
    next(error);
  }
};

/**
 * Get single order details
 * GET /api/delivery-partner/orders/:orderId
 */
exports.getOrderDetails = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const deliveryPartnerId = req.user.id;

    const order = await Order.findOne({
      _id: orderId,
      assignedDeliveryPartner: deliveryPartnerId
    })
      .populate('customer', 'name email phone')
      .populate('items.product', 'name image');

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found or not assigned to you'
      });
    }

    res.json({
      success: true,
      order: {
        id: order._id,
        orderId: order._id.toString().slice(-8).toUpperCase(),
        customer: {
          name: order.customer?.name || order.shippingAddress?.name,
          phone: order.customer?.phone || order.shippingAddress?.phone
        },
        shippingAddress: order.shippingAddress,
        items: order.items,
        total: order.total,
        subtotal: order.subtotal,
        deliveryFee: order.deliveryFee,
        deliveryStatus: order.deliveryStatus,
        status: order.status,
        statusHistory: order.statusHistory,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        deliveryType: order.deliveryType,
        deliveryETA: order.deliveryETA,
        payment: {
          method: order.payment?.method,
          status: order.payment?.status
        }
      }
    });
  } catch (error) {
    console.error('[DeliveryPartner] Get order details error:', error);
    next(error);
  }
};

/**
 * Update order delivery status
 * PATCH /api/delivery-partner/orders/:orderId/status
 * Body: { status: "Accepted" | "Picked Up" | "Out For Delivery" | "Delivered" }
 */
exports.updateOrderStatus = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;
    const deliveryPartnerId = req.user.id;

    // Validate status
    const validStatuses = ['Accepted', 'Picked Up', 'Out For Delivery', 'Delivered'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    // Find order and verify it's assigned to this delivery partner
    const order = await Order.findOne({
      _id: orderId,
      assignedDeliveryPartner: deliveryPartnerId
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found or not assigned to you'
      });
    }

    // Prevent updating if already delivered or cancelled
    if (order.deliveryStatus === 'Delivered' || order.deliveryStatus === 'Cancelled') {
      return res.status(400).json({
        success: false,
        error: `Cannot update order that is already ${order.deliveryStatus.toLowerCase()}`
      });
    }

    // Update delivery status
    const oldStatus = order.deliveryStatus;
    order.deliveryStatus = status;

    // Add to status history
    if (!order.statusHistory) {
      order.statusHistory = [];
    }

    order.statusHistory.push({
      status: status,
      timestamp: new Date(),
      updatedBy: deliveryPartnerId,
      updatedByRole: 'delivery_partner'
    });

    // If delivered, update proof of delivery timestamp
    if (status === 'Delivered') {
      if (!order.proofOfDelivery) {
        order.proofOfDelivery = {};
      }
      order.proofOfDelivery.deliveredAt = new Date();
      order.proofOfDelivery.deliveredBy = deliveryPartnerId;
      
      // Also update main status to delivered
      order.status = 'delivered';
    }

    await order.save();

    // Emit socket event for real-time update
    const io = req.app.get('io');
    if (io) {
      io.to(`order_${orderId}`).emit('orderStatusUpdated', {
        orderId: order._id,
        status: status,
        previousStatus: oldStatus,
        updatedAt: new Date(),
        statusHistory: order.statusHistory
      });
      console.log(`[Socket.io] Emitted orderStatusUpdated for order ${orderId}: ${status}`);
    }

    res.json({
      success: true,
      message: `Order status updated to ${status}`,
      order: {
        id: order._id,
        deliveryStatus: order.deliveryStatus,
        status: order.status,
        updatedAt: order.updatedAt,
        statusHistory: order.statusHistory
      }
    });
  } catch (error) {
    console.error('[DeliveryPartner] Update status error:', error);
    next(error);
  }
};

/**
 * Get delivery partner statistics
 * GET /api/delivery-partner/stats
 */
exports.getStats = async (req, res, next) => {
  try {
    const deliveryPartnerId = req.user.id;

    const [totalOrders, activeOrders, completedOrders, todayOrders] = await Promise.all([
      Order.countDocuments({ assignedDeliveryPartner: deliveryPartnerId }),
      Order.countDocuments({
        assignedDeliveryPartner: deliveryPartnerId,
        deliveryStatus: { $nin: ['Delivered', 'Cancelled'] }
      }),
      Order.countDocuments({
        assignedDeliveryPartner: deliveryPartnerId,
        deliveryStatus: 'Delivered'
      }),
      Order.countDocuments({
        assignedDeliveryPartner: deliveryPartnerId,
        createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) }
      })
    ]);

    res.json({
      success: true,
      stats: {
        totalOrders,
        activeOrders,
        completedOrders,
        todayOrders
      }
    });
  } catch (error) {
    console.error('[DeliveryPartner] Get stats error:', error);
    next(error);
  }
};
