const DeliveryZone = require('../models/DeliveryZone');

/**
 * Admin Delivery Zone Controller
 * Manage delivery zones from admin panel
 */

/**
 * Create new delivery zone
 * @route POST /api/admin/delivery-zones
 * @access Private (Admin only)
 */
exports.createDeliveryZone = async (req, res) => {
  try {
    console.log('=== Creating Delivery Zone ===');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    console.log('Request user:', req.user);
    
    const {
      name,
      type,
      polygon,
      center,
      radiusKm,
      deliveryFee,
      minOrderValue,
      estimatedDeliveryTime,
      description,
      isActive
    } = req.body;

    // Validate required fields
    if (!name || !type) {
      console.log('Validation failed: name or type missing');
      return res.status(400).json({
        success: false,
        message: 'Name and type are required'
      });
    }

    // Validate type-specific fields
    if (type === 'polygon') {
      if (!polygon || !Array.isArray(polygon) || polygon.length < 3) {
        return res.status(400).json({
          success: false,
          message: 'Polygon must have at least 3 points'
        });
      }
    } else if (type === 'radius') {
      if (!center || !center.lat || !center.lng || !radiusKm || radiusKm <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Valid center coordinates and radius are required for radius zones'
        });
      }
    } else {
      return res.status(400).json({
        success: false,
        message: 'Type must be either "polygon" or "radius"'
      });
    }

    const zone = new DeliveryZone({
      name,
      type,
      polygon,
      center,
      radiusKm,
      deliveryFee: deliveryFee || 0,
      minOrderValue: minOrderValue || 0,
      estimatedDeliveryTime,
      description,
      isActive: isActive !== undefined ? isActive : true
    });

    await zone.save();

    res.status(201).json({
      success: true,
      message: 'Delivery zone created successfully',
      zone
    });
  } catch (error) {
    console.error('Error creating delivery zone:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create delivery zone',
      error: error.message
    });
  }
};

/**
 * Get all delivery zones (including inactive)
 * @route GET /api/admin/delivery-zones
 * @access Private (Admin only)
 */
exports.getAllDeliveryZones = async (req, res) => {
  try {
    const { isActive } = req.query;
    
    const query = {};
    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    const zones = await DeliveryZone.find(query).sort({ createdAt: -1 });

    res.json({
      success: true,
      count: zones.length,
      zones
    });
  } catch (error) {
    console.error('Error fetching delivery zones:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch delivery zones',
      error: error.message
    });
  }
};

/**
 * Get single delivery zone by ID
 * @route GET /api/admin/delivery-zones/:id
 * @access Private (Admin only)
 */
exports.getDeliveryZoneById = async (req, res) => {
  try {
    const zone = await DeliveryZone.findById(req.params.id);

    if (!zone) {
      return res.status(404).json({
        success: false,
        message: 'Delivery zone not found'
      });
    }

    res.json({
      success: true,
      zone
    });
  } catch (error) {
    console.error('Error fetching delivery zone:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch delivery zone',
      error: error.message
    });
  }
};

/**
 * Update delivery zone
 * @route PUT /api/admin/delivery-zones/:id
 * @access Private (Admin only)
 */
exports.updateDeliveryZone = async (req, res) => {
  try {
    const zone = await DeliveryZone.findById(req.params.id);

    if (!zone) {
      return res.status(404).json({
        success: false,
        message: 'Delivery zone not found'
      });
    }

    // Update fields
    const updateFields = [
      'name', 'type', 'polygon', 'center', 'radiusKm',
      'deliveryFee', 'minOrderValue', 'estimatedDeliveryTime',
      'description', 'isActive'
    ];

    updateFields.forEach(field => {
      if (req.body[field] !== undefined) {
        zone[field] = req.body[field];
      }
    });

    // Validate type-specific fields
    if (zone.type === 'polygon') {
      if (!zone.polygon || zone.polygon.length < 3) {
        return res.status(400).json({
          success: false,
          message: 'Polygon must have at least 3 points'
        });
      }
    } else if (zone.type === 'radius') {
      if (!zone.center || !zone.center.lat || !zone.center.lng || !zone.radiusKm || zone.radiusKm <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Valid center coordinates and radius are required for radius zones'
        });
      }
    }

    await zone.save();

    res.json({
      success: true,
      message: 'Delivery zone updated successfully',
      zone
    });
  } catch (error) {
    console.error('Error updating delivery zone:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update delivery zone',
      error: error.message
    });
  }
};

/**
 * Delete delivery zone
 * @route DELETE /api/admin/delivery-zones/:id
 * @access Private (Admin only)
 */
exports.deleteDeliveryZone = async (req, res) => {
  try {
    const zone = await DeliveryZone.findByIdAndDelete(req.params.id);

    if (!zone) {
      return res.status(404).json({
        success: false,
        message: 'Delivery zone not found'
      });
    }

    res.json({
      success: true,
      message: 'Delivery zone deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting delivery zone:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete delivery zone',
      error: error.message
    });
  }
};

/**
 * Toggle zone active status
 * @route PATCH /api/admin/delivery-zones/:id/toggle
 * @access Private (Admin only)
 */
exports.toggleZoneStatus = async (req, res) => {
  try {
    const zone = await DeliveryZone.findById(req.params.id);

    if (!zone) {
      return res.status(404).json({
        success: false,
        message: 'Delivery zone not found'
      });
    }

    zone.isActive = !zone.isActive;
    await zone.save();

    res.json({
      success: true,
      message: `Delivery zone ${zone.isActive ? 'activated' : 'deactivated'}`,
      zone
    });
  } catch (error) {
    console.error('Error toggling zone status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to toggle zone status',
      error: error.message
    });
  }
};

/**
 * Get delivery zone statistics
 * @route GET /api/admin/delivery-zones/stats
 * @access Private (Admin only)
 */
exports.getDeliveryZoneStats = async (req, res) => {
  try {
    const Address = require('../models/Address');

    const totalZones = await DeliveryZone.countDocuments();
    const activeZones = await DeliveryZone.countDocuments({ isActive: true });
    const inactiveZones = totalZones - activeZones;

    // Count addresses by zone
    const addressesByZone = await Address.aggregate([
      {
        $match: { deliveryZoneId: { $exists: true, $ne: null } }
      },
      {
        $group: {
          _id: '$deliveryZoneId',
          count: { $sum: 1 }
        }
      },
      {
        $lookup: {
          from: 'deliveryzones',
          localField: '_id',
          foreignField: '_id',
          as: 'zone'
        }
      },
      {
        $unwind: '$zone'
      },
      {
        $project: {
          zoneName: '$zone.name',
          addressCount: '$count'
        }
      },
      {
        $sort: { addressCount: -1 }
      }
    ]);

    const totalAddresses = await Address.countDocuments();
    const verifiedAddresses = await Address.countDocuments({ isVerified: true });
    const unverifiedAddresses = totalAddresses - verifiedAddresses;

    res.json({
      success: true,
      stats: {
        zones: {
          total: totalZones,
          active: activeZones,
          inactive: inactiveZones
        },
        addresses: {
          total: totalAddresses,
          verified: verifiedAddresses,
          unverified: unverifiedAddresses
        },
        addressesByZone
      }
    });
  } catch (error) {
    console.error('Error fetching delivery zone stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch delivery zone statistics',
      error: error.message
    });
  }
};

module.exports = exports;
