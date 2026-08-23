const Newsletter = require('../models/Newsletter');
const mailService = require('../services/mail.service');
const logger = require('../utils/logger');

/**
 * Subscribe an email to the newsletter
 */
const subscribe = async (req, res) => {
  try {
    const { email } = req.body;

    // 1. Check if email was provided
    if (!email || typeof email !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Email address is required'
      });
    }

    // 2. Normalize email
    const normalizedEmail = email.trim().toLowerCase();

    // 3. Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid email address'
      });
    }

    // 4. Check if email is already subscribed
    const existingSubscriber = await Newsletter.findOne({
      email: normalizedEmail
    });

    if (existingSubscriber) {
      return res.status(409).json({
        success: false,
        message: 'This email is already subscribed'
      });
    }

    // 5. Save subscriber to MongoDB
    const subscriber = await Newsletter.create({
      email: normalizedEmail
    });

    // 6. Send welcome email
    try {
      await mailService.sendNewsletterWelcomeEmail(normalizedEmail);
    } catch (emailError) {
      logger.error(
        `Newsletter welcome email failed for ${normalizedEmail}:`,
        emailError
      );

      // Don't delete the subscriber if email sending fails.
      // The subscription itself was successful.
    }

    // 7. Send success response
    return res.status(201).json({
      success: true,
      message: 'Successfully subscribed to the newsletter',
      subscriberId: subscriber._id
    });

  } catch (error) {
    logger.error('Newsletter subscription error:', error);

    // Handle duplicate email race condition
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'This email is already subscribed'
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Unable to subscribe at the moment'
    });
  }
};

module.exports = {
  subscribe
};