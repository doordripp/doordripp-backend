const Notification = require('../models/Notification');

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function parsePagination(query = {}) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  return { page, limit, skip: (page - 1) * limit };
}

exports.listNotifications = async (req, res, next) => {
  try {
    const { status = 'all' } = req.query;
    const { page, limit, skip } = parsePagination(req.query);
    const query = { recipient: req.user.id };

    if (status === 'unread') {
      query.isRead = false;
    } else if (status === 'read') {
      query.isRead = true;
    }

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('order', '_id status total createdAt')
        .populate('deliveryZone', 'name')
        .lean(),
      Notification.countDocuments(query),
      Notification.countDocuments({ recipient: req.user.id, isRead: false })
    ]);

    res.json({
      notifications,
      unreadCount,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    next(err);
  }
};

exports.getUnreadCount = async (req, res, next) => {
  try {
    const unreadCount = await Notification.countDocuments({
      recipient: req.user.id,
      isRead: false
    });

    res.json({ unreadCount });
  } catch (err) {
    next(err);
  }
};

exports.markAsRead = async (req, res, next) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      {
        _id: req.params.id,
        recipient: req.user.id
      },
      {
        $set: {
          isRead: true,
          readAt: new Date()
        }
      },
      {
        new: true
      }
    );

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    const unreadCount = await Notification.countDocuments({
      recipient: req.user.id,
      isRead: false
    });

    res.json({ success: true, notification, unreadCount });
  } catch (err) {
    next(err);
  }
};

exports.markAllAsRead = async (req, res, next) => {
  try {
    const result = await Notification.updateMany(
      {
        recipient: req.user.id,
        isRead: false
      },
      {
        $set: {
          isRead: true,
          readAt: new Date()
        }
      }
    );

    res.json({
      success: true,
      updatedCount: result.modifiedCount || 0,
      unreadCount: 0
    });
  } catch (err) {
    next(err);
  }
};
