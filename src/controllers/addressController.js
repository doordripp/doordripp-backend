const Address = require('../models/Address');
const DeliveryZone = require('../models/DeliveryZone');
const axios = require('axios');
const logger = require('../utils/logger');

/**
 * Address Controller
 * Handles all address-related operations including geocoding and delivery zone validation
 */

/**
 * Calculate distance between two coordinates in meters using Haversine formula
 * @param {number} lat1 - Latitude of first point
 * @param {number} lng1 - Longitude of first point
 * @param {number} lat2 - Latitude of second point
 * @param {number} lng2 - Longitude of second point
 * @returns {number} Distance in meters
 */
const calculateDistance = (lat1, lng1, lat2, lng2) => {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lng2 - lng1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
};

/**
 * Get delivery settings
 * Returns all active delivery zones for frontend validation
 * @route GET /api/delivery-settings
 * @access Public
 */
exports.getDeliverySettings = async (req, res) => {
  try {
    const deliveryZones = await DeliveryZone.find({ isActive: true })
      .select('-createdAt -updatedAt -__v')
      .lean();

    res.json({
      success: true,
      zones: deliveryZones,
      message: deliveryZones.length > 0 
        ? 'Delivery zones retrieved successfully' 
        : 'No active delivery zones configured'
    });
  } catch (error) {
    logger.error('Error fetching delivery settings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch delivery settings',
      error: error.message
    });
  }
};

/**
 * Validate if a location is within delivery zones
 * @route POST /api/validate-location
 * @access Public
 */
exports.validateLocation = async (req, res) => {
  try {
    const { latitude, longitude } = req.body;

    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required'
      });
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);

    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid latitude or longitude values'
      });
    }

    // Validate coordinate ranges
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({
        success: false,
        message: 'Coordinates out of valid range (lat: -90 to 90, lng: -180 to 180)'
      });
    }

    // Check all active delivery zones
    const zones = await DeliveryZone.find({ isActive: true });
    
    let isInDeliveryZone = false;
    let matchingZone = null;

    for (const zone of zones) {
      if (zone.containsPoint(lat, lng)) {
        isInDeliveryZone = true;
        matchingZone = {
          id: zone._id,
          name: zone.name,
          deliveryFee: zone.deliveryFee,
          minOrderValue: zone.minOrderValue,
          estimatedDeliveryTime: zone.estimatedDeliveryTime
        };
        break;
      }
    }

    res.json({
      success: true,
      isInDeliveryZone,
      zone: matchingZone,
      message: isInDeliveryZone 
        ? 'Location is within delivery area' 
        : 'Location is outside delivery area'
    });
  } catch (error) {
    logger.error('Error validating location:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to validate location'
    });
  }
};

/**
 * Save a new address
 * @route POST /api/save-address
 * @access Private
 */
exports.saveAddress = async (req, res) => {
  try {
    const {
      latitude,
      longitude,
      formattedAddress,
      addressLine1,
      addressLine2,
      city,
      state,
      postalCode,
      country,
      label,
      isDefault,
      deliveryInstructions,
      contactName,
      contactPhone
    } = req.body;

    // Validate required fields
    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required'
      });
    }

    // ENFORCE LIMIT: Only 4 addresses max
    const existingCount = await Address.countDocuments({ userId: req.user._id });
    if (existingCount >= 4) {
      return res.status(400).json({
        success: false,
        message: 'You can only save up to 4 addresses. Please delete an existing address to add a new one.'
      });
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);

    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid latitude or longitude values'
      });
    }

    // CHECK FOR DUPLICATE ADDRESSES
    // Check if user already has an address at the same or very close location (within 20 meters)
    const userAddresses = await Address.find({ userId: req.user._id });
    
    for (const existingAddress of userAddresses) {
      const distance = calculateDistance(
        lat, 
        lng, 
        existingAddress.latitude, 
        existingAddress.longitude
      );
      
      // If address is within 20 meters, consider it a duplicate
      if (distance < 20) {
        return res.status(400).json({
          success: false,
          message: 'You already have this address saved.',
          existingAddress: {
            id: existingAddress._id,
            formattedAddress: existingAddress.formattedAddress,
            label: existingAddress.label
          }
        });
      }
    }

    // If no formatted address provided, use Google Geocoding API
    let addressToSave = formattedAddress;
    let addressComponents = {
      addressLine1,
      city,
      state,
      postalCode,
      country
    };

    if (!formattedAddress) {
      try {
        const geocodeResult = await geocodeLatLng(lat, lng);
        addressToSave = geocodeResult.formattedAddress;
        addressComponents = { ...addressComponents, ...geocodeResult.components };
      } catch (geocodeError) {
        return res.status(400).json({
          success: false,
          message: 'Unable to geocode the provided coordinates'
        });
      }
    }

    // Check if location is in a delivery zone
    const zones = await DeliveryZone.find({ isActive: true });
    let deliveryZoneId = null;

    for (const zone of zones) {
      if (zone.containsPoint(lat, lng)) {
        deliveryZoneId = zone._id;
        break;
      }
    }

    // Create new address
    const address = new Address({
      userId: req.user._id,
      formattedAddress: addressToSave,
      ...addressComponents,
      addressLine2,
      location: {
        type: 'Point',
        coordinates: [lng, lat] // GeoJSON format: [longitude, latitude]
      },
      latitude: lat,
      longitude: lng,
      label: label || 'Home',
      isDefault: isDefault || false,
      deliveryInstructions,
      contactName: contactName || req.user.name,
      contactPhone: contactPhone || req.user.phone,
      deliveryZoneId,
      isVerified: !!deliveryZoneId // Mark as verified if in delivery zone
    });

    await address.save();

    res.status(201).json({
      success: true,
      message: 'Address saved successfully',
      address: {
        id: address._id,
        formattedAddress: address.formattedAddress,
        latitude: address.latitude,
        longitude: address.longitude,
        label: address.label,
        isDefault: address.isDefault,
        isVerified: address.isVerified,
        isInDeliveryZone: !!deliveryZoneId
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to save address',
      message: 'Failed to save address'
    });
  }
};

/**
 * Get all addresses for the current user
 * @route GET /api/addresses
 * @access Private
 */
exports.getUserAddresses = async (req, res) => {
  try {
    const addresses = await Address.find({ userId: req.user._id })
      .sort({ isDefault: -1, createdAt: -1 })
      .populate('deliveryZoneId', 'name deliveryFee estimatedDeliveryTime')
      .lean();

    res.json({
      success: true,
      count: addresses.length,
      addresses
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch addresses',
      message: 'Failed to fetch addresses'
    });
  }
};

/**
 * Get a specific address by ID
 * @route GET /api/addresses/:id
 * @access Private
 */
exports.getAddressById = async (req, res) => {
  try {
    const address = await Address.findOne({
      _id: req.params.id,
      userId: req.user._id
    }).populate('deliveryZoneId', 'name deliveryFee estimatedDeliveryTime');

    if (!address) {
      return res.status(404).json({
        success: false,
        message: 'Address not found'
      });
    }

    res.json({
      success: true,
      address
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch address',
      message: 'Failed to fetch address'
    });
  }
};

/**
 * Update an existing address
 * @route PUT /api/addresses/:id
 * @access Private
 */
exports.updateAddress = async (req, res) => {
  try {
    const address = await Address.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!address) {
      return res.status(404).json({
        success: false,
        message: 'Address not found'
      });
    }

    // Update fields
    const updateFields = [
      'formattedAddress', 'addressLine1', 'addressLine2', 'city', 
      'state', 'postalCode', 'country', 'label', 'isDefault',
      'deliveryInstructions', 'contactName', 'contactPhone'
    ];

    updateFields.forEach(field => {
      if (req.body[field] !== undefined) {
        address[field] = req.body[field];
      }
    });

    // Update coordinates if provided
    if (req.body.latitude && req.body.longitude) {
      const lat = parseFloat(req.body.latitude);
      const lng = parseFloat(req.body.longitude);

      if (!isNaN(lat) && !isNaN(lng)) {
        address.latitude = lat;
        address.longitude = lng;
        address.location = {
          type: 'Point',
          coordinates: [lng, lat]
        };

        // Recheck delivery zone
        const zones = await DeliveryZone.find({ isActive: true });
        let deliveryZoneId = null;

        for (const zone of zones) {
          if (zone.containsPoint(lat, lng)) {
            deliveryZoneId = zone._id;
            break;
          }
        }

        address.deliveryZoneId = deliveryZoneId;
        address.isVerified = !!deliveryZoneId;
      }
    }

    await address.save();

    res.json({
      success: true,
      message: 'Address updated successfully',
      address
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to update address',
      message: 'Failed to update address'
    });
  }
};

/**
 * Delete an address
 * @route DELETE /api/addresses/:id
 * @access Private
 */
exports.deleteAddress = async (req, res) => {
  try {
    const address = await Address.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!address) {
      return res.status(404).json({
        success: false,
        message: 'Address not found'
      });
    }

    res.json({
      success: true,
      message: 'Address deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to delete address',
      message: 'Failed to delete address'
    });
  }
};

/**
 * Set an address as default
 * @route PATCH /api/addresses/:id/set-default
 * @access Private
 */
exports.setDefaultAddress = async (req, res) => {
  try {
    const address = await Address.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!address) {
      return res.status(404).json({
        success: false,
        message: 'Address not found'
      });
    }

    // Unset other defaults
    await Address.updateMany(
      { userId: req.user._id, _id: { $ne: address._id } },
      { isDefault: false }
    );

    address.isDefault = true;
    await address.save();

    res.json({
      success: true,
      message: 'Default address updated successfully',
      address
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to set default address',
      message: 'Failed to set default address'
    });
  }
};

/**
 * Geocode a location (lat/lng to address)
 * @route POST /api/geocode
 * @access Public
 */
exports.geocodeLocation = async (req, res) => {
  try {
    const { latitude, longitude } = req.body;

    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required'
      });
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);

    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid latitude or longitude values'
      });
    }

    const result = await geocodeLatLng(lat, lng);

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to geocode location',
      message: 'Failed to geocode location'
    });
  }
};

/**
 * Reverse geocode (address to lat/lng)
 * @route POST /api/reverse-geocode
 * @access Public
 */
exports.reverseGeocode = async (req, res) => {
  try {
    const { address } = req.body;

    if (!address) {
      return res.status(400).json({
        success: false,
        message: 'Address is required'
      });
    }

    const result = await reverseGeocodeAddress(address);

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to reverse geocode address',
      message: 'Failed to reverse geocode address'
    });
  }
};

/**
 * Helper function: Geocode latitude/longitude to address using Google Geocoding API
 */
async function geocodeLatLng(lat, lng) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  
  if (!apiKey) {
    throw new Error('Google Maps API key not configured');
  }

  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${apiKey}`;
  
  const response = await axios.get(url);
  
  if (response.data.status !== 'OK' || !response.data.results.length) {
    throw new Error('Unable to geocode coordinates');
  }

  const result = response.data.results[0];
  const components = {};

  // Parse address components
  result.address_components.forEach(component => {
    if (component.types.includes('street_number') || component.types.includes('route')) {
      components.addressLine1 = components.addressLine1 
        ? `${components.addressLine1} ${component.long_name}` 
        : component.long_name;
    }
    if (component.types.includes('locality')) {
      components.city = component.long_name;
    }
    if (component.types.includes('administrative_area_level_1')) {
      components.state = component.long_name;
    }
    if (component.types.includes('postal_code')) {
      components.postalCode = component.long_name;
    }
    if (component.types.includes('country')) {
      components.country = component.long_name;
    }
  });

  return {
    formattedAddress: result.formatted_address,
    components,
    location: result.geometry.location
  };
}

/**
 * Helper function: Reverse geocode address to lat/lng using Google Geocoding API
 */
async function reverseGeocodeAddress(address) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  
  if (!apiKey) {
    throw new Error('Google Maps API key not configured');
  }

  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
  
  const response = await axios.get(url);
  
  if (response.data.status !== 'OK' || !response.data.results.length) {
    throw new Error('Unable to geocode address');
  }

  const result = response.data.results[0];

  return {
    formattedAddress: result.formatted_address,
    location: result.geometry.location,
    latitude: result.geometry.location.lat,
    longitude: result.geometry.location.lng
  };
}

module.exports = exports;
