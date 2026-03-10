/**
 * Email utility - wrapper around the centralized mail service
 * Used by legacy controllers for backward compatibility
 */
const mailService = require('../services/mail.service');
const logger = require('./logger');

/**
 * Send OTP email for verification
 * @param {string} email - Recipient email address
 * @param {string} code - 6-digit OTP code
 * @param {string} purpose - Purpose of OTP (signup, login, etc.)
 * @returns {Promise<Object>} Result with success status
 */
const sendEmailOTP = async (email, code, purpose = 'signup') => {
  try {
    // Use the centralized mail service which handles all email sending
    await mailService.sendOtpEmail(email, code, purpose);
    return { success: true, via: 'email' };
  } catch (error) {
    logger.error('Email send failed:', error);
    // Log OTP only in development as fallback
    logger.debug(`OTP for ${email}: ${code}`);
    return { success: false, error: error.message };
  }
};

module.exports = { sendEmailOTP };
