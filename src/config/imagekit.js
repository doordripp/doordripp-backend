/**
 * ImageKit Configuration and Initialization
 * Initializes ImageKit client at server startup with comprehensive validation
 * and logging for debugging authentication issues.
 */

const ImageKit = require('imagekit');
const logger = require('../utils/logger');

let imagekitInstance = null;
let initError = null;

/**
 * Get ImageKit configuration from environment variables
 * @returns {Object} Configuration object with publicKey, privateKey, urlEndpoint
 */
const getImageKitConfig = () => {
  return {
    publicKey: process.env.IMAGEKIT_PUBLIC_KEY || '',
    privateKey: process.env.IMAGEKIT_PRIVATE_KEY || '',
    urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT || ''
  };
};

/**
 * Validate that all required ImageKit environment variables are present
 * @returns {Object} Object with { valid: boolean, missingVars: string[], config: Object }
 */
const validateImageKitConfig = () => {
  const config = getImageKitConfig();
  const missingVars = [];

  if (!config.publicKey || config.publicKey.trim() === '') {
    missingVars.push('IMAGEKIT_PUBLIC_KEY');
  }
  if (!config.privateKey || config.privateKey.trim() === '') {
    missingVars.push('IMAGEKIT_PRIVATE_KEY');
  }
  if (!config.urlEndpoint || config.urlEndpoint.trim() === '') {
    missingVars.push('IMAGEKIT_URL_ENDPOINT');
  }

  return {
    valid: missingVars.length === 0,
    missingVars,
    config
  };
};

/**
 * Initialize ImageKit client at server startup
 * Logs detailed information about initialization status
 * @returns {ImageKit|null} ImageKit instance or null if initialization failed
 */
const initializeImageKit = () => {
  try {
    logger.info('[ImageKit] Initializing ImageKit client...');

    const validation = validateImageKitConfig();

    // Log environment variable status (never log the actual private key value)
    logger.info('[ImageKit] Environment variable status:', {
      IMAGEKIT_PUBLIC_KEY_SET: !!validation.config.publicKey,
      IMAGEKIT_PRIVATE_KEY_SET: !!validation.config.privateKey,
      IMAGEKIT_URL_ENDPOINT_SET: !!validation.config.urlEndpoint
    });

    if (!validation.valid) {
      const errorMsg = `Missing required ImageKit environment variables: ${validation.missingVars.join(', ')}`;
      initError = new Error(errorMsg);
      logger.error(`[ImageKit] ${errorMsg}`);
      return null;
    }

    // Create ImageKit instance
    const config = {
      publicKey: validation.config.publicKey,
      privateKey: validation.config.privateKey,
      urlEndpoint: validation.config.urlEndpoint
    };

    imagekitInstance = new ImageKit(config);
    logger.info('[ImageKit] ✓ ImageKit client initialized successfully');
    logger.info(`[ImageKit] URL Endpoint: ${config.urlEndpoint}`);
    
    return imagekitInstance;
  } catch (error) {
    initError = error;
    logger.error('[ImageKit] Failed to initialize ImageKit client:', {
      message: error.message,
      stack: error.stack
    });
    return null;
  }
};

/**
 * Get the initialized ImageKit instance
 * Returns the cached instance or initializes it on first call
 * @returns {ImageKit|null} ImageKit instance or null if not available
 */
const getImageKitInstance = () => {
  if (imagekitInstance) {
    return imagekitInstance;
  }

  if (initError) {
    logger.warn('[ImageKit] ImageKit not available - previous initialization failed');
    return null;
  }

  // Initialize on first access if not already done
  return initializeImageKit();
};

/**
 * Check if ImageKit is properly initialized and ready to use
 * @returns {boolean} true if ImageKit is available and ready
 */
const isImageKitReady = () => {
  return imagekitInstance !== null && initError === null;
};

/**
 * Get initialization error if any
 * @returns {Error|null} The initialization error or null
 */
const getInitializationError = () => {
  return initError;
};

/**
 * Get ImageKit authentication parameters
 * This is the main method called by the frontend to get upload tokens
 * @returns {Object|null} Authentication parameters { token, expire, signature } or null if failed
 */
const getAuthenticationParameters = () => {
  try {
    if (!imagekitInstance) {
      const instance = getImageKitInstance();
      if (!instance) {
        throw new Error('ImageKit not initialized - credentials may be missing');
      }
      imagekitInstance = instance;
    }

    const authParams = imagekitInstance.getAuthenticationParameters();
    logger.debug('[ImageKit] Generated authentication parameters successfully', {
      tokenLength: authParams.token ? authParams.token.length : 0,
      signatureLength: authParams.signature ? authParams.signature.length : 0
    });
    return authParams;
  } catch (error) {
    logger.error('[ImageKit] Failed to generate authentication parameters:', {
      message: error.message,
      stack: error.stack
    });
    throw error;
  }
};

module.exports = {
  initializeImageKit,
  getImageKitInstance,
  getImageKitConfig,
  validateImageKitConfig,
  isImageKitReady,
  getInitializationError,
  getAuthenticationParameters
};
