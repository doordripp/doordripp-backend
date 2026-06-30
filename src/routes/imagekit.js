const express = require('express');
const { getImageKitAuth, getImageKitHealth, getImageKitConfigEndpoint } = require('../controllers/imagekitController');

const router = express.Router();

// ImageKit authentication endpoint - used by frontend for upload tokens
router.get('/imagekit-auth', getImageKitAuth);

// Compatibility aliases for different API path conventions
router.get('/imagekit/auth', getImageKitAuth);

// Health check endpoint for debugging ImageKit configuration
router.get('/imagekit-health', getImageKitHealth);

// Public configuration endpoint for frontend dynamic initialization
router.get('/imagekit-config', getImageKitConfigEndpoint);

module.exports = router;
