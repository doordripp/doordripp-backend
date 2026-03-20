/**
 * Test Login Script for anu123@gmail.com
 * Run: node test-login.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const USER_EMAIL = 'anu123@gmail.com';
const TEST_PASSWORD = 'User@123';

// Define User Schema inline to avoid model conflicts
const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  emailVerified: { type: Boolean, default: false },
  roles: { type: [String], default: [] },
  blocked: { type: Boolean, default: false },
  termsAccepted: { type: Boolean, default: true }
}, { timestamps: true });

// Add the password comparison method
UserSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password)
}

async function testLogin() {
  try {
    console.log('🚀 Connecting to MongoDB...\n');
    
    const uri = process.env.MONGO_URI;
    if (!uri) {
      console.error('❌ MONGO_URI not set in .env file');
      process.exit(1);
    }

    await mongoose.connect(uri);
    console.log('✅ Connected to MongoDB\n');

    const User = mongoose.model('User', UserSchema);

    console.log('🔍 Testing login logic...\n');

    // Step 1: Find user by email
    const user = await User.findOne({ email: USER_EMAIL });
    if (!user) {
      console.log('❌ Step 1 FAILED: User not found');
      return;
    }
    console.log('✅ Step 1 PASSED: User found');

    // Step 2: Check password
    const match = await user.matchPassword(TEST_PASSWORD);
    if (!match) {
      console.log('❌ Step 2 FAILED: Password does not match');
      return;
    }
    console.log('✅ Step 2 PASSED: Password matches');

    // Step 3: Check if blocked
    if (user.blocked) {
      console.log('❌ Step 3 FAILED: Account is blocked');
      return;
    }
    console.log('✅ Step 3 PASSED: Account not blocked');

    // Step 4: Check if email is verified
    if (!user.emailVerified) {
      console.log('❌ Step 4 FAILED: Email not verified');
      return;
    }
    console.log('✅ Step 4 PASSED: Email is verified');

    console.log('\n🎉 ALL LOGIN CHECKS PASSED!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('The login should work. Issue might be:');
    console.log('1. Frontend is sending wrong data');
    console.log('2. Backend server not running');
    console.log('3. Network/CORS issues');
    console.log('4. Case sensitivity in email');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');
  }
}

testLogin();