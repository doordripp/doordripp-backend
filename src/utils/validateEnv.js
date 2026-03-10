/**
 * Environment Variable Validation
 * Validates all required environment variables at startup
 */

const logger = require('./logger');

const validateEnvironment = () => {
  const requiredVars = [
    'MONGO_URI',
    'JWT_SECRET',
  ];

  const optionalVars = [
    'BREVO_API_KEY',
    'IMAGEKIT_PRIVATE_KEY',
    'IMAGEKIT_URL_ENDPOINT',
    'RAZORPAY_KEY_ID',
    'RAZORPAY_KEY_SECRET',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_CALLBACK_URL',
  ];

  // Check required variables
  const missingRequired = requiredVars.filter(v => !process.env[v] || process.env[v].trim() === '');
  
  if (missingRequired.length > 0) {
    const error = `Missing required environment variables: ${missingRequired.join(', ')}`;
    logger.error(error);
    throw new Error(error);
  }

  // Validate JWT_SECRET is not default/weak
  if (process.env.JWT_SECRET === 'secret' || process.env.JWT_SECRET.length < 16) {
    const error = 'JWT_SECRET must be at least 16 characters and not the default value';
    logger.error(error);
    throw new Error(error);
  }

  // Warn about missing optional variables
  const missingOptional = optionalVars.filter(v => !process.env[v]);
  if (missingOptional.length > 0 && process.env.NODE_ENV === 'production') {
    logger.warn(`Optional environment variables not set: ${missingOptional.join(', ')}`);
  }

  logger.info('Environment variables validated successfully');
  return true;
};

module.exports = validateEnvironment;
