const express = require('express');
const ImageKit = require('imagekit');
const router = express.Router();

// Initialize ImageKit instance
const imagekit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY || '',
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY || '',
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT || ''
});

// Authentication endpoint for ImageKit uploads
router.get('/imagekit-auth', (req, res) => {
  try {
    const authenticationParameters = imagekit.getAuthenticationParameters();
    res.send(authenticationParameters);
  } catch (error) {
    console.error('ImageKit auth error:', error);
    res.status(500).json({ 
      error: 'Failed to generate auth parameters',
      message: error.message 
    });
  }
});

module.exports = router;
