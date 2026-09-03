/**
 * Environment Variable Validation
 * Validates required environment variables at server startup.
 * Fails fast with a clear error if any required variable is missing.
 */

const requiredEnvVars = [
  'MONGO_URI',
  'JWT_SECRET',
  'IMAGEKIT_PUBLIC_KEY',
  'IMAGEKIT_PRIVATE_KEY',
  'IMAGEKIT_URL_ENDPOINT',
];

// Optional but important vars — log a warning if missing
const recommendedEnvVars = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_CLIENT_ID_DEV',
  'GOOGLE_CLIENT_SECRET_DEV',
  // Push notifications degrade gracefully when unset, so these only warn.
  'ONESIGNAL_APP_ID',
  'ONESIGNAL_REST_API_KEY',
  // App (customer-facing) push notifications — separate OneSignal account.
  'APP_ONESIGNAL_APP_ID',
  'APP_ONESIGNAL_REST_API_KEY',
];

const googleAppAudienceVars = [
  'GOOGLE_APP_CLIENT_ID_1',
  'GOOGLE_APP_CLIENT_ID_2',
];

function isBrevoConfigured() {
  const hasApiKey = Boolean(process.env.BREVO_API_KEY && process.env.BREVO_API_KEY.trim());
  const hasSmtpUser = Boolean(process.env.SMTP_USER && process.env.SMTP_USER.trim());
  const hasSmtpPass = Boolean(process.env.SMTP_PASS && process.env.SMTP_PASS.trim());
  return hasApiKey || (hasSmtpUser && hasSmtpPass);
}

function hasCompleteConfig(keys) {
  return keys.every(key => Boolean(process.env[key] && process.env[key].trim()));
}

function hasAnyConfig(keys) {
  return keys.some(key => Boolean(process.env[key] && process.env[key].trim()));
}

function isWeakJwtSecret(secret) {
  if (!secret || !secret.trim()) {
    return true;
  }

  const normalized = secret.trim();
  if (normalized === 'secret') {
    return true;
  }

  if (normalized.includes('CHANGE-THIS-IN-PRODUCTION')) {
    return true;
  }

  return normalized.length < 32;
}

function validateEnv() {
  const missing = requiredEnvVars.filter(v => !process.env[v]);

  if (missing.length > 0) {
    throw new Error(
      `[Startup] Missing required environment variables: ${missing.join(', ')}\n` +
      'Please set them in your .env file before starting the server.'
    );
  }

  if (isWeakJwtSecret(process.env.JWT_SECRET)) {
    const message = '[Startup] JWT_SECRET is weak or still using the placeholder value.';
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`${message} Configure a strong secret before starting the server.`);
    }
    process.stderr.write(`${message} Local development should use a strong secret too.\n`);
  }

  const missingRecommended = recommendedEnvVars.filter(v => !process.env[v]);
  if (!isBrevoConfigured()) {
    missingRecommended.push('BREVO_API_KEY or SMTP_USER+SMTP_PASS');
  }
  if (missingRecommended.length > 0) {
    // Use process.stderr directly here since the logger module is not yet loaded at startup
    process.stderr.write(
      `[Startup] Warning: Recommended environment variables not set: ${missingRecommended.join(', ')}\n`
    );
  }

  // App client IDs are optional and only needed when accepting mobile app idTokens.
  const hasWebGoogleClientId = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_ID.trim());
  const hasAnyGoogleAppAudience = googleAppAudienceVars.some(
    v => Boolean(process.env[v] && process.env[v].trim())
  );

  if (hasWebGoogleClientId && !hasAnyGoogleAppAudience) {
    process.stderr.write(
      '[Startup] Info: GOOGLE_APP_CLIENT_ID_1/GOOGLE_APP_CLIENT_ID_2 not set; mobile Google idTokens will be rejected.\n'
    );
  }

  const smtpKeys = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'];
  const legacyMailKeys = ['MAIL_HOST', 'MAIL_USER', 'MAIL_PASS'];
  if (hasAnyConfig(smtpKeys) && !hasCompleteConfig(smtpKeys)) {
    process.stderr.write('[Startup] Warning: SMTP config is partial; mail sending may fail.\n');
  }
  if (hasAnyConfig(legacyMailKeys) && !hasCompleteConfig(legacyMailKeys)) {
    process.stderr.write('[Startup] Warning: legacy MAIL_* config is partial; OTP email fallback may fail.\n');
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const razorpayKeyId = String(process.env.RAZORPAY_KEY_ID || '').trim();
  const razorpayKeySecret = String(process.env.RAZORPAY_KEY_SECRET || '').trim();
  const razorpayWebhookSecret = String(process.env.RAZORPAY_WEBHOOK_SECRET || '').trim();
  const skipVerification = String(process.env.RAZORPAY_TEST_MODE_SKIP_VERIFICATION || '').trim().toLowerCase() === 'true';

  const hasRazorpayAny = Boolean(razorpayKeyId || razorpayKeySecret || razorpayWebhookSecret);
  const hasRazorpayAll = Boolean(razorpayKeyId && razorpayKeySecret && razorpayWebhookSecret);

  if (hasRazorpayAny && !hasRazorpayAll) {
    throw new Error('[Startup] Razorpay configuration is partial. Set RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, and RAZORPAY_WEBHOOK_SECRET together.');
  }

  if (isProduction) {
    if (!hasRazorpayAll) {
      throw new Error('[Startup] Razorpay live integration is required in production. Missing RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET/RAZORPAY_WEBHOOK_SECRET.');
    }

    if (!/^rzp_live_/i.test(razorpayKeyId)) {
      throw new Error('[Startup] Production must use Razorpay live key (RAZORPAY_KEY_ID should start with rzp_live_).');
    }

    if (skipVerification) {
      throw new Error('[Startup] RAZORPAY_TEST_MODE_SKIP_VERIFICATION=true is not allowed in production.');
    }
  } else {
    if (razorpayKeyId && /^rzp_live_/i.test(razorpayKeyId)) {
      process.stderr.write('[Startup] Warning: live Razorpay key is configured outside production.\n');
    }
  }
}

module.exports = validateEnv;
