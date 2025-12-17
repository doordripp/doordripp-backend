/**
 * Quick test to verify Brevo SMTP connection
 * Run: node test-brevo.js
 */

require('dotenv').config();
const nodemailer = require('nodemailer');

async function testBrevoConnection() {
  console.log('\n🔍 Testing Brevo SMTP Connection...\n');

  // Check environment variables
  console.log('📋 Configuration Check:');
  console.log(`SMTP_HOST: ${process.env.SMTP_HOST}`);
  console.log(`SMTP_PORT: ${process.env.SMTP_PORT}`);
  console.log(`SMTP_USER: ${process.env.SMTP_USER}`);
  console.log(`SMTP_PASS: ${process.env.SMTP_PASS ? '***' + process.env.SMTP_PASS.slice(-10) : 'NOT SET'}`);
  console.log(`MAIL_FROM: ${process.env.MAIL_FROM}`);
  console.log(`MAIL_FROM_NAME: ${process.env.MAIL_FROM_NAME}\n`);

  // Validate all required fields
  const required = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'];
  const missing = required.filter(v => !process.env[v]);
  
  if (missing.length > 0) {
    console.error(`❌ Missing environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }

  try {
    // Create transporter
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT),
      secure: false, // TLS on port 587
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      },
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 30000
    });

    // Verify connection
    console.log('🔗 Attempting connection to Brevo SMTP...');
    await transporter.verify();
    console.log('✅ Connection verified successfully!\n');

    // Test sending email
    console.log('📧 Sending test email...');
    const testOTP = '123456';
    const testEmail = process.env.MAIL_FROM; // Send to your configured email

    const info = await transporter.sendMail({
      from: `"${process.env.MAIL_FROM_NAME}" <${process.env.SMTP_USER}>`,
      to: testEmail,
      subject: `🧪 Brevo SMTP Test - OTP: ${testOTP}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; }
            .header { background: #4CAF50; color: white; padding: 20px; text-align: center; border-radius: 5px; }
            .otp-code { font-size: 32px; font-weight: bold; text-align: center; margin: 30px 0; letter-spacing: 2px; }
            .footer { text-align: center; margin-top: 30px; color: #999; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>DoorDripp Brevo SMTP Test</h1>
            </div>
            <p>This is a test email to verify Brevo SMTP is working correctly.</p>
            <div class="otp-code">${testOTP}</div>
            <p>✅ If you received this email, Brevo SMTP is configured correctly!</p>
            <p>You can now use real email delivery for OTP verification.</p>
            <div class="footer">
              <p>Test sent at: ${new Date().toLocaleString()}</p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `Test OTP: ${testOTP}\n\nIf you received this, Brevo SMTP is working!`
    });

    console.log(`✅ Test email sent successfully!`);
    console.log(`Message ID: ${info.messageId}`);
    console.log(`\n📬 Check your email inbox for the test message!`);
    console.log(`\n🎉 Brevo SMTP is now ready for OTP delivery!\n`);

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Connection failed:', error.message);
    console.error('\nTroubleshooting steps:');
    console.error('1. Verify Brevo account is activated: https://app.brevo.com');
    console.error('2. Check email verification status');
    console.error('3. Verify SMTP credentials are correct');
    console.error('4. Ensure firewall allows SMTP port 587');
    console.error('5. Check if Brevo account has sending limits\n');
    process.exit(1);
  }
}

testBrevoConnection();
