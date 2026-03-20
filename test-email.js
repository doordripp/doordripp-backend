/**
 * Quick email test script
 * Usage: node test-email.js your-email@example.com
 */
require('dotenv').config();
const mailService = require('./src/services/mail.service');

const testEmail = process.argv[2] || 'test@example.com';
const testOTP = '123456';

console.log('🧪 Testing email service...');
console.log(`📧 Sending test OTP to: ${testEmail}`);
console.log(`🔑 OTP Code: ${testOTP}`);
console.log('\nSMTP Configuration:');
console.log(`  Host: ${process.env.SMTP_HOST}`);
console.log(`  Port: ${process.env.SMTP_PORT}`);
console.log(`  User: ${process.env.SMTP_USER}`);
console.log(`  Pass: ${process.env.SMTP_PASS ? '***configured***' : 'NOT SET'}`);
console.log('');

mailService.sendOtpEmail(testEmail, testOTP, 'signup')
  .then((result) => {
    console.log('✅ Email sent successfully!');
    console.log('Result:', result);
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Email send failed!');
    console.error('Error:', error.message);
    console.error('\nTroubleshooting:');
    console.error('1. Check that SMTP credentials are correct in .env');
    console.error('2. Verify Brevo SMTP key is valid (not expired)');
    console.error('3. Check internet connection');
    console.error('4. Verify sender email is authorized in Brevo');
    process.exit(1);
  });
