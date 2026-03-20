/**
 * Comprehensive Brevo Email Diagnostic
 * Run: node diagnose-brevo.js
 */

require('dotenv').config();
const nodemailer = require('nodemailer');
const path = require('path');

async function diagnoseBrevo() {
  console.log('\n' + '='.repeat(60));
  console.log('🔍 BREVO SMTP DIAGNOSTIC TOOL');
  console.log('='.repeat(60) + '\n');

  // 1. Check Environment Variables
  console.log('📋 STEP 1: Checking Environment Variables');
  console.log('-'.repeat(60));

  const vars = {
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASS: process.env.SMTP_PASS ? '***' + process.env.SMTP_PASS.slice(-15) : 'NOT SET',
    MAIL_FROM: process.env.MAIL_FROM,
    MAIL_FROM_NAME: process.env.MAIL_FROM_NAME,
    NODE_ENV: process.env.NODE_ENV
  };

  Object.entries(vars).forEach(([key, value]) => {
    const status = value && value !== 'NOT SET' ? '✅' : '❌';
    console.log(`${status} ${key}: ${value || '(not set)'}`);
  });

  // Check for missing required vars
  const required = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'];
  const missing = required.filter(v => !process.env[v]);

  if (missing.length > 0) {
    console.error(`\n❌ FATAL: Missing required environment variables: ${missing.join(', ')}`);
    console.error('Unable to proceed without these variables.\n');
    process.exit(1);
  }

  // 2. Validate Configuration
  console.log('\n📋 STEP 2: Validating Configuration');
  console.log('-'.repeat(60));

  if (!process.env.SMTP_HOST.includes('brevo')) {
    console.warn('⚠️  WARNING: SMTP_HOST does not contain "brevo". Expected: smtp-relay.brevo.com');
  } else {
    console.log('✅ SMTP_HOST looks correct');
  }

  const port = parseInt(process.env.SMTP_PORT);
  if (port === 587 || port === 465) {
    console.log(`✅ SMTP_PORT is valid: ${port}`);
  } else {
    console.warn(`⚠️  WARNING: Unusual SMTP_PORT: ${port}. Expected 587 or 465.`);
  }

  if (process.env.SMTP_USER.includes('@smtp-brevo')) {
    console.log('✅ SMTP_USER looks correct (Brevo format)');
  } else {
    console.warn('⚠️  WARNING: SMTP_USER does not look like Brevo format');
  }

  // 3. Create Transporter
  console.log('\n📋 STEP 3: Creating Email Transporter');
  console.log('-'.repeat(60));

  let transporter;
  try {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: port,
      secure: port === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      },
      logger: true,
      debug: true,
      pool: {
        maxConnections: 5,
        maxMessages: 100
      },
      connectionTimeout: 10000,
      socketTimeout: 30000
    });
    console.log('✅ Transporter created successfully');
  } catch (error) {
    console.error('❌ Failed to create transporter:', error.message);
    process.exit(1);
  }

  // 4. Test SMTP Connection
  console.log('\n📋 STEP 4: Testing SMTP Connection');
  console.log('-'.repeat(60));

  try {
    console.log('🔗 Connecting to Brevo SMTP server...');
    await transporter.verify();
    console.log('✅ SMTP Connection Successful!');
    console.log('✅ Your Brevo account is ready to send emails\n');
  } catch (error) {
    console.error('❌ SMTP Connection Failed:', error.message);
    console.error('\n⚠️  Possible causes:');
    console.error('   1. Brevo account not activated - https://app.brevo.com');
    console.error('   2. Email not verified in Brevo');
    console.error('   3. SMTP credentials are incorrect');
    console.error('   4. SMTP account not activated in Brevo');
    console.error('   5. Firewall blocking port 587\n');
    process.exit(1);
  }

  // 5. Send Test Email
  console.log('📋 STEP 5: Sending Test Email');
  console.log('-'.repeat(60));

  const testOTP = Math.floor(100000 + Math.random() * 900000).toString();
  const testEmail = process.env.MAIL_FROM || 'test@example.com';

  try {
    console.log(`📧 Sending test email to: ${testEmail}`);
    console.log(`OTP: ${testOTP}`);

    const result = await transporter.sendMail({
      from: `"${process.env.MAIL_FROM_NAME || 'DoorDripp'}" <${process.env.SMTP_USER}>`,
      to: testEmail,
      subject: `🧪 Brevo SMTP Test - OTP: ${testOTP}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; background: #f5f5f5; }
            .container { max-width: 600px; margin: 20px auto; padding: 30px; background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; margin: -30px -30px 30px -30px; }
            .header h1 { margin: 0; font-size: 24px; }
            .content { padding: 20px 0; }
            .otp-box { background: #f0f0f0; border: 2px solid #667eea; border-radius: 8px; padding: 20px; text-align: center; margin: 30px 0; }
            .otp-code { font-size: 48px; font-weight: bold; color: #667eea; letter-spacing: 4px; font-family: 'Courier New', monospace; }
            .note { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 4px; }
            .footer { text-align: center; margin-top: 40px; color: #999; font-size: 12px; border-top: 1px solid #ddd; padding-top: 20px; }
            .success { color: #28a745; font-weight: bold; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>✅ Brevo SMTP Configuration Successful!</h1>
            </div>
            <div class="content">
              <p>This is a test email to verify that your Brevo SMTP configuration is working correctly.</p>
              
              <div class="otp-box">
                <p style="margin: 0; color: #666; font-size: 14px;">Your Test OTP Code:</p>
                <div class="otp-code">${testOTP}</div>
              </div>

              <div class="note">
                <strong>🎉 Success!</strong> If you're reading this email, your Brevo SMTP is properly configured and ready to send OTPs.
              </div>

              <h3>Next Steps:</h3>
              <ol>
                <li>Go to your app's forgot password page: <code>/forgot-password</code></li>
                <li>Enter your email address</li>
                <li>You should receive the OTP in your email inbox (not console anymore)</li>
                <li>Complete the password reset process</li>
              </ol>

              <div class="note" style="background: #d4edda; border-left-color: #28a745;">
                <strong>✅ Ready to go!</strong> Your forgotten password OTP emails will now be delivered to users' inboxes.
              </div>
            </div>
            <div class="footer">
              <p>Test sent: ${new Date().toLocaleString()}</p>
              <p>If you didn't expect this email, you can safely ignore it.</p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `✅ Brevo SMTP Test Successful!\n\nTest OTP Code: ${testOTP}\n\nIf you received this email, your Brevo SMTP configuration is working correctly!`
    });

    console.log('✅ Test email sent successfully!');
    console.log(`   Message ID: ${result.messageId}`);
    console.log(`   Response: ${result.response}`);
  } catch (error) {
    console.error('❌ Failed to send test email:', error.message);
    process.exit(1);
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('✅ DIAGNOSTIC COMPLETE - ALL TESTS PASSED');
  console.log('='.repeat(60));
  console.log('\n🎉 Your Brevo SMTP is ready for production!');
  console.log('\n📝 What this means:');
  console.log('   • Users will receive OTPs in their email inbox');
  console.log('   • Password reset emails will be delivered reliably');
  console.log('   • No more console-only mode');
  console.log('\n📧 Check your email for the test message above.');
  console.log('   Then test the forgot password flow on your app.\n');

  process.exit(0);
}

diagnoseBrevo().catch(error => {
  console.error('\n❌ Diagnostic failed:', error.message);
  process.exit(1);
});
