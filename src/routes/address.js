const express = require('express');
const router = express.Router();
const addressController = require('../controllers/addressController');
const { verifyToken } = require('../middleware/auth');

/**
 * Address Routes
 * All routes require authentication
 */

// Get delivery settings (public route - no auth required)
router.get('/delivery-settings', addressController.getDeliverySettings);

// Validate if a location is within delivery zones
router.post('/validate-location', addressController.validateLocation);

// Save a new address
router.post('/save-address', verifyToken, addressController.saveAddress);

// Get all addresses for the current user
router.get('/addresses', verifyToken, addressController.getUserAddresses);

// Get a specific address by ID
router.get('/addresses/:id', verifyToken, addressController.getAddressById);

// Update an existing address
router.put('/addresses/:id', verifyToken, addressController.updateAddress);

// Delete an address
router.delete('/addresses/:id', verifyToken, addressController.deleteAddress);

// Set an address as default
router.patch('/addresses/:id/set-default', verifyToken, addressController.setDefaultAddress);

// Geocode a location (lat/lng to address)
router.post('/geocode', addressController.geocodeLocation);

// Reverse geocode (address to lat/lng)
router.post('/reverse-geocode', addressController.reverseGeocode);

module.exports = router;
