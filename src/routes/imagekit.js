const express = require('express');
const logger = require('../utils/logger');
const ImageKit = require('imagekit');
const router = express.Router();

const hasImageKitConfig = () => Boolean(
  process.env.IMAGEKIT_PUBLIC_KEY &&
  process.env.IMAGEKIT_PRIVATE_KEY &&
  process.env.IMAGEKIT_URL_ENDPOINT
);

const getImageKitInstance = () => {
  if (!hasImageKitConfig()) {
    return null;
  }

  return new ImageKit({
    publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
    privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
    urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT
  });
};

// Authentication endpoint for ImageKit uploads
router.get('/imagekit-auth', (req, res) => {
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
});

module.exports = router;
