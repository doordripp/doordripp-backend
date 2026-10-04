// Runs before every test file. Tests never read the developer's .env and never
// connect to a real database: MongoDB is an in-memory replica set (see db.js).
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-only-jwt-secret-0123456789-abcdefghijklmnopqrstuvwxyz';
process.env.MONGO_URI = '';
process.env.DISABLE_RATE_LIMIT = 'true';

process.env.GOOGLE_CLIENT_ID = '111111111111-webclientaaaaaaaaaaaaaaaaaaaaaaaa.apps.googleusercontent.com';
process.env.GOOGLE_APP_CLIENT_ID_1 = '111111111111-iosclientbbbbbbbbbbbbbbbbbbbbbbbb.apps.googleusercontent.com';
process.env.GOOGLE_APP_CLIENT_ID_2 = '';
process.env.GOOGLE_ACCEPTED_CLIENT_IDS = '';
delete process.env.GOOGLE_CLIENT_SECRET;
delete process.env.GOOGLE_CLIENT_ID_DEV;
delete process.env.GOOGLE_CLIENT_SECRET_DEV;

process.env.RAZORPAY_KEY_ID = 'rzp_test_unit';
process.env.RAZORPAY_KEY_SECRET = 'unit-test-razorpay-key-secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'unit-test-razorpay-webhook-secret';

process.env.APPLE_BUNDLE_ID = 'com.example.test';
delete process.env.APP_ONESIGNAL_APP_ID;
delete process.env.APP_ONESIGNAL_REST_API_KEY;
delete process.env.ONESIGNAL_APP_ID;
delete process.env.ONESIGNAL_REST_API_KEY;
delete process.env.TWILIO_ACCOUNT_SID;
