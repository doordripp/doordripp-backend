/**
 * Environment Variable Validation
 * Validates required environment variables at server startup.
 * Fails fast with a clear error if any required variable is missing.
 */

const requiredEnvVars = [
  'MONGO_URI',
  'JWT_SECRET',
];

// Optional but important vars — log a warning if missing
const recommendedEnvVars = [
  'IMAGEKIT_PRIVATE_KEY',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
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
}

module.exports = validateEnv;
