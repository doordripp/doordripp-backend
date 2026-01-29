/**
 * Check User Script for anu123@gmail.com
 * Run: node check-anu-user.js
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

async function checkUser() {
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

    // Check if user exists
    const user = await User.findOne({ email: USER_EMAIL });

    if (!user) {
      console.log('❌ User not found!');
      console.log(`   Email: ${USER_EMAIL}`);
      return;
    }

    console.log('✅ User found!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📧 Email:          ', user.email);
    console.log('👤 Name:           ', user.name);
    console.log('👥 Roles:          ', user.roles);
    console.log('✅ Email Verified: ', user.emailVerified);
    console.log('🚫 Blocked:        ', user.blocked);
    console.log('📋 Terms Accepted: ', user.termsAccepted);
    console.log('🆔 ID:             ', user._id);
    console.log('🔐 Password Hash:  ', user.password.substring(0, 20) + '...');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Test password
    console.log('🔍 Testing password...');
    const isMatch = await user.matchPassword(TEST_PASSWORD);
    console.log(`   Password "${TEST_PASSWORD}": ${isMatch ? '✅ MATCH' : '❌ NO MATCH'}`);

    if (!isMatch) {
      console.log('\n🔧 Fixing password...');
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(TEST_PASSWORD, salt);
      
      await User.findByIdAndUpdate(user._id, { password: hashedPassword });
      console.log('✅ Password updated successfully!');
      
      // Test again
      const updatedUser = await User.findById(user._id);
      const newMatch = await updatedUser.matchPassword(TEST_PASSWORD);
      console.log(`   New password test: ${newMatch ? '✅ MATCH' : '❌ STILL NO MATCH'}`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');
  }
}

checkUser();