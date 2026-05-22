const express = require('express');
const logger = require('../utils/logger');
const { getImageKitInstance } = require('../utils/imagekit-upload');
const router = express.Router();

// Authentication endpoint for ImageKit uploads
const sendImageKitAuth = (req, res) => {
  try {
    const imagekit = getImageKitInstance();

    if (!imagekit) {
      return res.status(503).json({
        error: 'ImageKit is not configured',
        message: 'Set IMAGEKIT_PUBLIC_KEY, IMAGEKIT_PRIVATE_KEY, and IMAGEKIT_URL_ENDPOINT to enable uploads.'
      });
    }

    const authenticationParameters = imagekit.getAuthenticationParameters();
    res.send(authenticationParameters);
  } catch (error) {
    logger.error('ImageKit auth error:', error);
    res.status(500).json({ 
      error: 'Failed to generate auth parameters',
      message: error.message 
    });
  }
};

router.get('/imagekit-auth', sendImageKitAuth);
// Compatibility alias used by older docs/clients.
router.get('/imagekit/auth', sendImageKitAuth);

module.exports = router;
