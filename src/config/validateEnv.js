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

function isBrevoConfigured() {
  const hasApiKey = Boolean(process.env.BREVO_API_KEY && process.env.BREVO_API_KEY.trim());
  const hasSmtpUser = Boolean(process.env.SMTP_USER && process.env.SMTP_USER.trim());
  const hasSmtpPass = Boolean(process.env.SMTP_PASS && process.env.SMTP_PASS.trim());
  return hasApiKey || (hasSmtpUser && hasSmtpPass);
}

function validateEnv() {
  const missing = requiredEnvVars.filter(v => !process.env[v]);

  if (missing.length > 0) {
    throw new Error(
      `[Startup] Missing required environment variables: ${missing.join(', ')}\n` +
      'Please set them in your .env file before starting the server.'
    );
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
}

module.exports = validateEnv;
