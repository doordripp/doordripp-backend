/**
 * Logger utility for development and production
 * Only logs to console in development mode
 */

const isDevelopment = process.env.NODE_ENV !== 'production';
const isProduction = process.env.NODE_ENV === 'production';

const logger = {
  /**
   * Log info messages (development only)
   */
  info: (...args) => {
    if (isDevelopment) {
      console.log('[INFO]', ...args);
    }
  },

  /**
   * Log debug messages (development only)
   */
  debug: (...args) => {
    if (isDevelopment && process.env.DEBUG === 'true') {
      console.log('[DEBUG]', ...args);
    }
  },

  /**
   * Log warnings (both development and production)
   */
  warn: (message, details = null) => {
    const timestamp = new Date().toISOString();
    console.warn(`[WARN ${timestamp}]`, message);
    if (isDevelopment && details) {
      console.warn(details);
    }
  },

  /**
   * Log errors (both development and production)
   * Sanitizes sensitive data in production
   */
  error: (message, error = null) => {
    const timestamp = new Date().toISOString();
    console.error(`[ERROR ${timestamp}]`, message);
    
    if (error) {
      if (isDevelopment) {
        console.error(error);
        if (error.stack) console.error(error.stack);
      } else {
        // In production, only log message, not full error details
        console.error(`[ERROR ${timestamp}]`, error.message || String(error));
      }
    }
  },

  /**
   * Log socket events (development only)
   */
  socket: (...args) => {
    if (isDevelopment) {
      console.log('[SOCKET]', ...args);
    }
  },

  /**
   * Log API requests (development only)
   */
  request: (...args) => {
    if (isDevelopment) {
      console.log('[REQUEST]', ...args);
    }
  },

  /**
   * Log security events (always, but sanitized in production)
   */
  security: (event, details = null) => {
    const timestamp = new Date().toISOString();
    console.error(`[SECURITY ${timestamp}]`, event);
    if (isDevelopment && details) {
      console.error(details);
    }
  },
};

module.exports = logger;
