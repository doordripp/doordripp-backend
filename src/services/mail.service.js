const nodemailer = require('nodemailer');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');
const { getAdminOrdersUrl, getClientUrl, getOrderUrl } = require('../utils/appUrls');
let SibApiV3Sdk = null; // Lazy-load Brevo SDK

/**
 * Centralized Email Service using Nodemailer + Brevo (Sendinblue) SMTP
 * 
 * Security Best Practices:
 * - All credentials stored in environment variables
 * - No sensitive data in email templates (tokens, passwords, etc.)
 * - Rate limiting should be implemented at route level
 * - Email content sanitized to prevent injection attacks
 * 
 * @module MailService
 */

class MailService {
  constructor() {
    this.transporter = null;
    this.initialized = false;
    this.templateCache = new Map(); // Cache loaded templates
    this.initializationPromise = null; // Prevent concurrent initialization
  }

  /**
   * Initialize email transporter with Brevo SMTP configuration
   * Lazy initialization - only creates transporter when first needed
   * 
   * @throws {Error} If SMTP credentials are missing
   */
  async initialize() {
    if (this.initialized) return;
    
    // Prevent concurrent initialization (race condition fix)
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = this._doInitialize();
    await this.initializationPromise;
    this.initializationPromise = null;
  }

  async _doInitialize() {
    if (this.initialized) return;

    // Validate required environment variables
    const requiredVars = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'];
    const missing = requiredVars.filter(v => !process.env[v]);
    
    if (missing.length > 0) {
      logger.warn(`Email service not configured. Missing: ${missing.join(', ')}`);
      logger.warn('Emails will be logged to console instead.');
      this.initialized = true; // Mark as initialized to prevent repeated warnings
      return;
    }

    try {
      // Create Nodemailer transporter with Brevo SMTP
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST, // smtp-relay.brevo.com
        port: parseInt(process.env.SMTP_PORT), // 587 for TLS
        secure: process.env.SMTP_PORT === '465', // true for 465, false for other ports
        auth: {
          user: process.env.SMTP_USER, // Your Brevo login email
          pass: process.env.SMTP_PASS  // Your Brevo SMTP key (NOT your account password)
        },
        // Connection pooling for better performance
        pool: true,
        maxConnections: 5,
        maxMessages: 100,
        // Timeout settings
        connectionTimeout: 10000, // 10 seconds
        greetingTimeout: 10000,
        socketTimeout: 30000 // 30 seconds
      });

      // Verify SMTP connection
      await this.transporter.verify();
      logger.info('Email service initialized successfully (Brevo SMTP)');
      this.initialized = true;
    } catch (error) {
      logger.error('Failed to initialize email service:', error);
      // Try initializing Brevo API as fallback if API key is provided
      if (process.env.BREVO_API_KEY) {
        try {
          if (!SibApiV3Sdk) {
            SibApiV3Sdk = require('sib-api-v3-sdk');
          }
          SibApiV3Sdk.ApiClient.instance.authentications['api-key'].apiKey = process.env.BREVO_API_KEY;
          this.brevoApi = new SibApiV3Sdk.TransactionalEmailsApi();
          logger.info('Brevo API initialized (fallback mode)');
        } catch (apiErr) {
          logger.error('Failed to initialize Brevo API fallback:', apiErr);
          logger.warn('Emails will be logged to console instead.');
          this.brevoApi = null;
        }
      } else {
        logger.warn('Emails will be logged to console instead.');
      }
      this.transporter = null;
      this.initialized = true; // Still mark as initialized to prevent retry loops
    }
  }

  /**
   * Load HTML email template from file
   * 
   * @param {String} templateName - Template filename (e.g., 'otp.html')
   * @returns {Promise<String>} HTML template content
   */
  async loadTemplate(templateName) {
    // Check cache first (performance optimization)
    if (this.templateCache.has(templateName)) {
      return this.templateCache.get(templateName);
    }

    try {
      const templatePath = path.join(__dirname, '../templates', templateName);
      const template = await fs.readFile(templatePath, 'utf-8');
      
      // Cache template in production (reduce file I/O)
      if (process.env.NODE_ENV === 'production') {
        this.templateCache.set(templateName, template);
      }
      
      return template;
    } catch (error) {
      logger.error(`Failed to load email template: ${templateName}`, error);
      // Return fallback template instead of throwing
      return this.getFallbackTemplate(templateName);
    }
  }

  /**
   * Fallback template when main template fails to load
   */
  getFallbackTemplate(templateName) {
    return `
      <!DOCTYPE html>
      <html>
      <head><meta charset="UTF-8"></head>
      <body style="font-family: Arial, sans-serif; padding: 20px;">
        <h2>DoorDripp</h2>
        <p>{{content}}</p>
        <p><small>This is a fallback email. Template "${templateName}" could not be loaded.</small></p>
      </body>
      </html>
    `;
  }

  /**
   * Replace placeholders in HTML template with actual values
   * 
   * @param {String} template - HTML template string
   * @param {Object} variables - Key-value pairs to replace
   * @returns {String} Processed HTML
   */
  replacePlaceholders(template, variables) {
    let processed = template;
    Object.entries(variables).forEach(([key, value]) => {
      const placeholder = new RegExp(`{{${key}}}`, 'g');
      processed = processed.replace(placeholder, value || '');
    });
    return processed;
  }

  /**
   * Send email (main method)
   * Falls back to console logging if SMTP not configured
   * 
   * @param {Object} options - Email options
   * @param {String} options.to - Recipient email address
   * @param {String} options.subject - Email subject
   * @param {String} options.html - HTML body
   * @param {String} options.text - Plain text body (optional fallback)
   * @returns {Promise<Object>} Result with success status
   */
  async sendEmail({ to, subject, html, text = '' }) {
    await this.initialize();

    // Validate and sanitize recipient email (prevent header injection)
    if (!to || !this.isValidEmail(to)) {
      throw new Error('Invalid recipient email address');
    }

    // Sanitize inputs to prevent email header injection
    const sanitizedTo = this.sanitizeEmailInput(to);
    const sanitizedSubject = this.sanitizeEmailInput(subject);

    // Validate subject line length (prevent abuse)
    if (!sanitizedSubject || sanitizedSubject.length > 200) {
      throw new Error('Invalid email subject');
    }

    const mailOptions = {
      from: `"${process.env.MAIL_FROM_NAME || 'DoorDripp'}" <${process.env.MAIL_FROM || process.env.SMTP_USER}>`,
      to: sanitizedTo,
      subject: sanitizedSubject,
      html,
      text: text || this.stripHtml(html) // Fallback to stripped HTML if no text provided
    };

    // If SMTP not configured or failed, try Brevo API fallback
    if (!this.transporter) {
      if (this.brevoApi) {
        try {
          const senderEmail = process.env.MAIL_FROM || process.env.SMTP_USER;
          const senderName = process.env.MAIL_FROM_NAME || 'DoorDripp';
          const sendResult = await this.brevoApi.sendTransacEmail({
            sender: { email: senderEmail, name: senderName },
            to: [{ email: sanitizedTo }],
            subject: sanitizedSubject,
            htmlContent: html,
            textContent: text || this.stripHtml(html)
          });
          logger.info(`Email sent via Brevo API to ${to}`);
          return { success: true, messageId: sendResult?.messageId || 'brevo-api', mode: 'brevo-api' };
        } catch (apiErr) {
          logger.error(`Brevo API send failed for ${to}:`, apiErr);
          // Fallthrough to console logging
        }
      }
      // Final fallback: console logging
      console.log('\n📧 ===== EMAIL (Console Mode) =====');
      console.log(`To: ${to}`);
      console.log(`Subject: ${subject}`);
      console.log(`Body: ${text || this.stripHtml(html)}`);
      console.log('===================================\n');
      return { success: true, mode: 'console' };
    }

    try {
      const info = await this.transporter.sendMail(mailOptions);
      logger.info(`Email sent to ${to}: ${info.messageId}`);
      return { success: true, messageId: info.messageId, mode: 'smtp' };
    } catch (error) {
      logger.error(`SMTP send failed for ${to}:`, error);
      
      // If SMTP fails, try Brevo API fallback
      if (this.brevoApi) {
        try {
          const senderEmail = process.env.MAIL_FROM || process.env.SMTP_USER;
          const senderName = process.env.MAIL_FROM_NAME || 'DoorDripp';
          const sendResult = await this.brevoApi.sendTransacEmail({
            sender: { email: senderEmail, name: senderName },
            to: [{ email: sanitizedTo }],
            subject: sanitizedSubject,
            htmlContent: mailOptions.html,
            textContent: mailOptions.text
          });
          logger.info(`Email sent via Brevo API fallback to ${to}`);
          return { success: true, messageId: sendResult?.messageId || 'brevo-api', mode: 'brevo-api-fallback' };
        } catch (apiErr) {
          logger.error(`Brevo API fallback also failed for ${to}:`, apiErr);
        }
      }
      
      // Final fallback: console logging
      console.log('\n📧 ===== EMAIL (Console Mode Fallback) =====');
      console.log(`To: ${to}`);
      console.log(`Subject: ${subject}`);
      console.log(`Body: ${mailOptions.text}`);
      console.log('==========================================\n');
      return { success: true, mode: 'console-fallback' };
    }
  }

  /**
   * Send OTP verification email
   * 
   * Security Notes:
   * - OTP is only sent via email, never stored in plaintext
   * - 6-digit numeric code for usability
   * - 5-minute expiration clearly communicated
   * 
   * @param {String} email - Recipient email
   * @param {String} otp - 6-digit OTP code
   * @param {String} purpose - Purpose of OTP (signup, login, reset)
   * @returns {Promise<Object>} Send result
   */
  async sendOtpEmail(email, otp, purpose = 'signup') {
    const template = await this.loadTemplate('otp.html');
    
    const purposeText = {
      'signup': 'complete your registration',
      'login': 'verify your login',
      'reset-password': 'reset your password',
      'verify-email': 'verify your email address'
    }[purpose] || 'verify your identity';

    const html = this.replacePlaceholders(template, {
      otp,
      purpose: purposeText,
      expiryMinutes: '5',
      currentYear: new Date().getFullYear(),
      supportEmail: process.env.SUPPORT_EMAIL || 'support@doordripp.com',
      clientUrl: process.env.CLIENT_URL || process.env.FRONTEND_URL || 'https://doordripp.com'
    });


    return this.sendEmail({
      to: email,
      subject: `Your DoorDripp Verification Code - ${otp}`,
      html,
      text: `Your verification code is: ${otp}. This code will expire in 5 minutes. Use it to ${purposeText}.`
    });
  }

  /**
   * Send order confirmation email
   * 
   * Security Notes:
   * - No payment details included (for PCI compliance)
   * - Order ID can be used to look up details in customer portal
   * - No sensitive customer data beyond what's necessary
   * 
   * @param {Object} orderData - Order information
   * @returns {Promise<Object>} Send result
   */
  async sendOrderConfirmation(orderData) {
    const template = await this.loadTemplate('order-confirmation.html');
    
    const html = this.replacePlaceholders(template, {
      customerName: orderData.customerName || 'Valued Customer',
      orderId: orderData.orderId,
      orderDate: new Date(orderData.orderDate).toLocaleDateString('en-IN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }),
      totalAmount: `₹${orderData.totalAmount.toLocaleString('en-IN')}`,
      itemCount: orderData.items.length,
      items: this.formatOrderItems(orderData.items),
      shippingAddress: this.formatAddress(orderData.shippingAddress),
      estimatedDelivery: orderData.estimatedDelivery || 'Within 5-7 business days',
      trackingUrl: getOrderUrl(orderData.orderId),
      currentYear: new Date().getFullYear(),
      supportEmail: process.env.SUPPORT_EMAIL || 'support@doordripp.com',
      clientUrl: getClientUrl()
    });

    return this.sendEmail({
      to: orderData.customerEmail,
      subject: `Order Confirmation - #${orderData.orderId}`,
      html
    });
  }

  /**
   * Send manager order notification email
   * Alerts delivery zone managers about new orders in their area
   * 
   * @param {Object} orderData - Order and customer information
   * @returns {Promise<Object>} Send result
   */
  async sendManagerOrderNotification(orderData) {
    const template = await this.loadTemplate('manager-order-notification.html');
    
    // Format delivery address
    const address = orderData.shippingAddress;
    let deliveryAddress = '';
    if (address) {
      const parts = [
        address.street || address.line1,
        address.line2,
        address.city,
        address.state,
        address.zip
      ].filter(Boolean);
      deliveryAddress = parts.join(', ');
    }

    const html = this.replacePlaceholders(template, {
      managerName: orderData.managerName || 'Manager',
      customerName: orderData.customerName || 'Customer',
      customerPhone: orderData.customerPhone || 'N/A',
      deliveryAddress: deliveryAddress || 'Address not provided',
      orderId: orderData.orderId,
      orderDate: new Date(orderData.orderDate).toLocaleDateString('en-IN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }),
      totalAmount: `₹${orderData.totalAmount.toLocaleString('en-IN')}`,
      itemCount: orderData.items.length,
      items: this.formatOrderItems(orderData.items),
      zoneName: orderData.zoneName || 'Your Zone',
      trackingUrl: getAdminOrdersUrl(orderData.orderId),
      currentYear: new Date().getFullYear()
    });

    return this.sendEmail({
      to: orderData.managerEmail,
      subject: `🚨 New Order in ${orderData.zoneName || 'Your Zone'} - #${orderData.orderId}`,
      html
    });
  }

  /**
   * Send password reset email
   * 
   * Security Notes:
   * - Uses short-lived token (not OTP) for password reset
   * - Token embedded in URL, expires in 1 hour
   * - No user information revealed in case of invalid email
   * - Clear warning about unsolicited reset requests
   * 
   * @param {String} email - User email
   * @param {String} resetToken - JWT token for password reset
   * @param {String} userName - User's name
   * @returns {Promise<Object>} Send result
   */
  async sendPasswordResetEmail(email, resetToken, userName = 'User') {
    const template = await this.loadTemplate('reset-password.html');
    
    // Build reset URL - use FRONTEND_URL first, fallback to CLIENT_URL, fallback to default
    const baseUrl = getClientUrl();
    const resetUrl = `${baseUrl}/reset-password?token=${resetToken}`;
    
    const html = this.replacePlaceholders(template, {
      userName,
      resetUrl,
      expiryHours: '1',
      currentYear: new Date().getFullYear(),
      supportEmail: process.env.SUPPORT_EMAIL || 'support@doordripp.com',
      clientUrl: baseUrl
    });

    return this.sendEmail({
      to: email,
      subject: 'Reset Your DoorDripp Password',
      html,
      text: `Reset your password by clicking this link: ${resetUrl}. This link expires in 1 hour. If you didn't request this, please ignore this email.`
    });
  }

  /**
   * Notify user after successful password reset
   * Best-effort; failure should not block the API response
   */
  async sendPasswordResetSuccessEmail(email, userName = 'User') {
    const safeUserName = userName || 'User';
    const clientUrl = getClientUrl();
    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111;">
        <h2 style="color: #111;">Your password was reset</h2>
        <p>Hi ${safeUserName},</p>
        <p>This is a confirmation that your DoorDripp account password was just changed.</p>
        <p>If you did not perform this action, please reset your password immediately and contact support.</p>
        <p>
          <a href="${clientUrl}/reset-password" style="background:#111;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;">
            Reset Password Again
          </a>
        </p>
        <p style="font-size: 12px; color: #555;">If the button doesn’t work, visit ${clientUrl}/reset-password</p>
        <p style="margin-top:24px;font-size: 12px; color: #777;">If this wasn’t you, please secure your account immediately.</p>
      </div>
    `;

    return this.sendEmail({
      to: email,
      subject: 'Your DoorDripp password was changed',
      html,
      text: `Your DoorDripp account password was changed. If this wasn't you, reset it immediately at ${clientUrl}/reset-password.`
    });
  }

  /**
   * Send shipping status update email
   * 
   * @param {Object} shippingData - Shipping information
   * @returns {Promise<Object>} Send result
   */
  async sendShippingUpdate(shippingData) {
    const statusMessages = {
      'processing': 'Your order is being prepared',
      'shipped': 'Your order has been shipped',
      'in-transit': 'Your order is on the way',
      'out-for-delivery': 'Your order is out for delivery',
      'delivered': 'Your order has been delivered'
    };

    const template = await this.loadTemplate('shipping-update.html');
    
    const html = this.replacePlaceholders(template, {
      customerName: shippingData.customerName || 'Valued Customer',
      orderId: shippingData.orderId,
      status: shippingData.status,
      statusMessage: statusMessages[shippingData.status] || 'Order status updated',
      trackingNumber: shippingData.trackingNumber || 'N/A',
      carrier: shippingData.carrier || 'Standard Delivery',
      estimatedDelivery: shippingData.estimatedDelivery || 'Soon',
      trackingUrl: shippingData.trackingUrl || getOrderUrl(shippingData.orderId),
      currentYear: new Date().getFullYear(),
      supportEmail: process.env.SUPPORT_EMAIL || 'support@doordripp.com',
      clientUrl: getClientUrl()
    });

    return this.sendEmail({
      to: shippingData.customerEmail,
      subject: `Shipping Update - Order #${shippingData.orderId}`,
      html
    });
  }

  /**
   * Send invoice email with PDF attachment
   * 
   * @param {Object} invoiceData - Invoice information
   * @param {String} invoiceData.customerName - Customer name
   * @param {String} invoiceData.customerEmail - Customer email
   * @param {String} invoiceData.invoiceNumber - Invoice number
   * @param {String} invoiceData.pdfPath - Path to invoice PDF file
   * @returns {Promise<Object>} Send result
   */
  async sendInvoiceEmail(invoiceData) {
    await this.initialize();

    const { customerName, customerEmail, invoiceNumber, pdfPath } = invoiceData;

    if (!customerEmail || !this.isValidEmail(customerEmail)) {
      throw new Error('Invalid customer email address');
    }

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 28px;">Tax Invoice</h1>
        </div>
        
        <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
          <p style="font-size: 16px; margin-bottom: 20px;">Dear ${customerName || 'Valued Customer'},</p>
          
          <p style="font-size: 14px; line-height: 1.8; margin-bottom: 20px;">
            Thank you for your purchase! Please find your GST invoice attached to this email.
          </p>
          
          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea;">
            <p style="margin: 0; font-size: 14px; color: #666;">Invoice Number</p>
            <p style="margin: 5px 0 0 0; font-size: 18px; font-weight: bold; color: #333;">${invoiceNumber}</p>
          </div>
          
          <p style="font-size: 14px; line-height: 1.8; margin-bottom: 20px;">
            This is a GST-compliant tax invoice for your records. Please keep it safe for any future reference or warranty claims.
          </p>
          
          <div style="background: #fff3cd; border: 1px solid #ffc107; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p style="margin: 0; font-size: 13px; color: #856404;">
              <strong>Note:</strong> If you have any questions about your invoice, please contact our support team.
            </p>
          </div>
          
          <p style="font-size: 14px; color: #666; margin-top: 30px;">
            Best regards,<br>
            <strong>Team DoorDripp</strong>
          </p>
        </div>
        
        <div style="text-align: center; padding: 20px; font-size: 12px; color: #999;">
          <p>This is an automated email. Please do not reply to this message.</p>
          <p>&copy; ${new Date().getFullYear()} DoorDripp. All rights reserved.</p>
        </div>
      </body>
      </html>
    `;

    const mailOptions = {
      from: `"${process.env.MAIL_FROM_NAME || 'DoorDripp'}" <${process.env.MAIL_FROM || process.env.SMTP_USER}>`,
      to: this.sanitizeEmailInput(customerEmail),
      subject: `Your Invoice ${invoiceNumber} - DoorDripp`,
      html,
      text: `Dear ${customerName}, Thank you for your purchase! Your invoice ${invoiceNumber} is attached. Best regards, Team DoorDripp`
    };

    // Attach PDF if available
    if (pdfPath) {
      try {
        const fs = require('fs');
        if (fs.existsSync(pdfPath)) {
          mailOptions.attachments = [{
            filename: `Invoice-${invoiceNumber.replace(/\//g, '-')}.pdf`,
            path: pdfPath,
            contentType: 'application/pdf'
          }];
        } else {
          logger.warn(`Invoice PDF not found: ${pdfPath}`);
        }
      } catch (err) {
        logger.error('Error attaching invoice PDF:', err);
      }
    }

    // Send email
    if (!this.transporter) {
      console.log('\n📧 ===== INVOICE EMAIL (Console Mode) =====');
      console.log(`To: ${customerEmail}`);
      console.log(`Subject: Your Invoice ${invoiceNumber}`);
      console.log(`Invoice PDF: ${pdfPath || 'Not attached'}`);
      console.log('==========================================\n');
      return { success: true, mode: 'console' };
    }

    try {
      const info = await this.transporter.sendMail(mailOptions);
      logger.info(`Invoice email sent to ${customerEmail}: ${info.messageId}`);
      return { success: true, messageId: info.messageId, mode: 'smtp' };
    } catch (error) {
      logger.error(`Failed to send invoice email to ${customerEmail}:`, error);
      // Fallback to console
      console.log('\n📧 ===== INVOICE EMAIL (Console Fallback) =====');
      console.log(`To: ${customerEmail}`);
      console.log(`Subject: Your Invoice ${invoiceNumber}`);
      console.log(`Invoice PDF: ${pdfPath || 'Not attached'}`);
      console.log('=============================================\n');
      return { success: true, mode: 'console-fallback' };
    }
  }

  // ========== Helper Methods ==========

  /**
   * Validate email format
   */
  isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Sanitize email input to prevent header injection
   * Removes newlines, carriage returns, and null bytes
   */
  sanitizeEmailInput(input) {
    if (!input || typeof input !== 'string') return '';
    // Remove characters that could be used for email header injection
    return input.replace(/[\r\n\x00]/g, '').trim();
  }

  /**
   * Strip HTML tags for plain text fallback
   */
  stripHtml(html) {
    return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Format order items for email template
   */
  formatOrderItems(items) {
    return items.map(item => `
      <tr>
        <td style="padding: 12px; border-bottom: 1px solid #eee;">
          ${item.name}
          ${item.variant ? `<br><small style="color: #666;">${item.variant}</small>` : ''}
        </td>
        <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: center;">
          ${item.quantity}
        </td>
        <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: right;">
          ₹${item.price.toLocaleString('en-IN')}
        </td>
      </tr>
    `).join('');
  }

  /**
   * Format shipping address
   */
  formatAddress(address) {
    if (!address) return 'Address not provided';
    return `
      ${address.street}<br>
      ${address.city}, ${address.state} ${address.zip}<br>
      ${address.country || 'India'}
    `;
  }
}

// Export singleton instance
module.exports = new MailService();
