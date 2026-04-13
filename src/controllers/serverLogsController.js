const DeploymentLog = require('../models/DeploymentLog');

exports.getServerLogs = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    const logs = await DeploymentLog.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);
      
    const total = await DeploymentLog.countDocuments();

    res.json({
      success: true,
      logs,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching server logs:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch server logs' });
  }
};
