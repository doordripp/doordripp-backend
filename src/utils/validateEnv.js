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
    'APPLE_BUNDLE_ID',
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

  const razorpayKeyId = String(process.env.RAZORPAY_KEY_ID || '').trim();
  const razorpayKeySecret = String(process.env.RAZORPAY_KEY_SECRET || '').trim();
  const razorpayWebhookSecret = String(process.env.RAZORPAY_WEBHOOK_SECRET || '').trim();

  // Prevent partial Razorpay setup that can cause runtime payment failures.
  if ((razorpayKeyId && !razorpayKeySecret) || (!razorpayKeyId && razorpayKeySecret)) {
    const error = 'RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must both be set together';
    logger.error(error);
    throw new Error(error);
  }

  if (process.env.NODE_ENV === 'production' && razorpayKeyId && !razorpayWebhookSecret) {
    logger.warn('RAZORPAY_WEBHOOK_SECRET is not set while Razorpay keys are configured in production. Webhook verification will fail closed.');
  }

  if (
    process.env.NODE_ENV === 'production' &&
    process.env.GOOGLE_CALLBACK_URL &&
    process.env.GOOGLE_CALLBACK_URL.includes('localhost')
  ) {
    logger.warn('GOOGLE_CALLBACK_URL points to localhost in production. Google OAuth will fail with redirect_uri_mismatch.');
  }

  logger.info('Environment variables validated successfully');
  return true;
};

module.exports = validateEnvironment;
