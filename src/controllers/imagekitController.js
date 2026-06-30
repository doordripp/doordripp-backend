/**
 * ImageKit Controller
 * Handles ImageKit authentication endpoint for frontend image uploads
 * Provides detailed logging for debugging upload issues
 */

const logger = require('../utils/logger');
const imagekit = require('../config/imagekit');

/**
 * Get ImageKit authentication parameters for frontend uploads
 * GET /api/imagekit-auth
 * 
 * Returns authentication tokens required for frontend to upload images directly to ImageKit
 * Response format: { token, expire, signature }
 */
const getImageKitAuth = (req, res) => {
  try {
    logger.info('[ImageKit Auth] Received authentication request from frontend');
    
    // Check if ImageKit is ready
    if (!imagekit.isImageKitReady()) {
      const error = imagekit.getInitializationError();
      const errorMsg = error 
        ? error.message 
        : 'ImageKit is not configured. Check IMAGEKIT_PUBLIC_KEY, IMAGEKIT_PRIVATE_KEY, and IMAGEKIT_URL_ENDPOINT.';
      
      logger.error('[ImageKit Auth] ImageKit not ready:', {
        message: errorMsg,
        stack: error ? error.stack : 'N/A'
      });

      return res.status(503).json({
        success: false,
        message: 'ImageKit authentication service is not available',
        error: errorMsg,
        timestamp: new Date().toISOString()
      });
    }

    // Get authentication parameters
    const authParams = imagekit.getAuthenticationParameters();

    if (!authParams || !authParams.token || !authParams.signature) {
      logger.error('[ImageKit Auth] Invalid authentication parameters generated:', {
        hasToken: !!authParams?.token,
        hasSignature: !!authParams?.signature,
        hasExpire: !!authParams?.expire
      });

      return res.status(500).json({
        success: false,
        message: 'Failed to generate valid authentication parameters',
        timestamp: new Date().toISOString()
      });
    }

    logger.info('[ImageKit Auth] ✓ Authentication parameters generated successfully', {
      tokenLength: authParams.token.length,
      signatureLength: authParams.signature.length,
      expire: authParams.expire
    });

    // Return authentication parameters to frontend
    res.status(200).json({
      token: authParams.token,
      expire: authParams.expire,
      signature: authParams.signature,
      success: true,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('[ImageKit Auth] Unexpected error generating authentication parameters:', {
      message: error.message,
      stack: error.stack,
      errorType: error.constructor.name
    });

    res.status(500).json({
      success: false,
      message: 'Failed to get authentication token',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * Health check endpoint for ImageKit configuration
 * GET /api/imagekit-health
 * 
 * Returns the status of ImageKit initialization and configuration
 * Useful for debugging deployment issues
 */
const getImageKitHealth = (req, res) => {
  try {
    const config = imagekit.getImageKitConfig();
    const validation = imagekit.validateImageKitConfig();
    const isReady = imagekit.isImageKitReady();
    const error = imagekit.getInitializationError();

    const response = {
      status: isReady ? 'healthy' : 'unhealthy',
      imageKitReady: isReady,
      configurationStatus: {
        hasPublicKey: !!config.publicKey,
        hasPrivateKey: !!config.privateKey,
        hasUrlEndpoint: !!config.urlEndpoint,
        isValid: validation.valid
      },
      missingVariables: validation.missingVars,
      error: error ? error.message : null,
      timestamp: new Date().toISOString()
    };

    const statusCode = isReady ? 200 : 503;
    res.status(statusCode).json(response);
  } catch (err) {
    logger.error('[ImageKit Health] Error checking health:', {
      message: err.message,
      stack: err.stack
    });

    res.status(500).json({
      status: 'error',
      message: 'Failed to check ImageKit health',
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * Get ImageKit public configuration for the frontend
 * GET /api/imagekit-config
 */
const getImageKitConfigEndpoint = (req, res) => {
  try {
    const config = imagekit.getImageKitConfig();
    const isReady = imagekit.isImageKitReady();
    
    // We only expose publicKey and urlEndpoint, NEVER privateKey
    res.status(200).json({
      success: true,
      isConfigured: isReady && !!config.publicKey && !!config.urlEndpoint,
      publicKey: config.publicKey,
      urlEndpoint: config.urlEndpoint,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    logger.error('[ImageKit Config] Error getting config:', {
      message: err.message
    });
    res.status(500).json({
      success: false,
      message: 'Failed to get ImageKit configuration',
      error: err.message
    });
  }
};

module.exports = {
  getImageKitAuth,
  getImageKitHealth,
  getImageKitConfigEndpoint
};
