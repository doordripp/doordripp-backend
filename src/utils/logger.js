/**
 * Logger utility for development and production.
 * Provides structured timestamps and levels for log aggregation systems.
 */

const isDevelopment = process.env.NODE_ENV !== 'production';

const logger = {
  /**
   * Log info messages (operational logs in both dev & production)
   */
  info: (...args) => {
    const timestamp = new Date().toISOString();
    console.log(`[INFO ${timestamp}]`, ...args);
  },

  /**
   * Log debug messages (enabled when DEBUG=true or in dev)
   */
  debug: (...args) => {
    if (isDevelopment || process.env.DEBUG === 'true') {
      const timestamp = new Date().toISOString();
      console.log(`[DEBUG ${timestamp}]`, ...args);
    }
  },

  /**
   * Log warnings (both development and production)
   */
  warn: (message, details = null) => {
    const timestamp = new Date().toISOString();
    console.warn(`[WARN ${timestamp}]`, message);
    if (details) {
      if (details instanceof Error) {
        console.warn(details.message);
      } else {
        console.warn(details);
      }
    }
  },

  /**
   * Log errors (both development and production)
   */
  error: (message, error = null) => {
    const timestamp = new Date().toISOString();
    console.error(`[ERROR ${timestamp}]`, message);
    
    if (error) {
      if (error.stack) {
        console.error(error.stack);
      } else {
        console.error(String(error));
      }
    }
  },

  /**
   * Log socket events
   */
  socket: (...args) => {
    if (isDevelopment || process.env.DEBUG === 'true') {
      const timestamp = new Date().toISOString();
      console.log(`[SOCKET ${timestamp}]`, ...args);
    }
  },

  /**
   * Log API requests
   */
  request: (...args) => {
    if (isDevelopment) {
      console.log('[REQUEST]', ...args);
    }
  },

  /**
   * Log security events (always recorded)
   */
  security: (event, details = null) => {
    const timestamp = new Date().toISOString();
    console.error(`[SECURITY ${timestamp}]`, event);
    if (details) {
      console.error(details);
    }
  },
};

module.exports = logger;
