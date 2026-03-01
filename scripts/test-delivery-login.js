#!/usr/bin/env node
/**
 * Script to test login credentials for delivery partner
 * Usage: node scripts/test-delivery-login.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../src/models/User');

const TEST_EMAIL = 'delivery.partner@test.com';
const TEST_PASSWORD = 'Delivery@123';

async function testLogin() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/doordripp');
    console.log('✅ Connected to MongoDB\n');

    // Find the user
    console.log('🔍 Finding user...');
    const user = await User.findOne({ email: TEST_EMAIL });
    
    if (!user) {
      console.log('❌ User not found with email:', TEST_EMAIL);
      await mongoose.connection.close();
      process.exit(1);
    }
    console.log('✅ User found:', user.email);

    // Test password matching
    console.log('\n🔐 Testing password...');
    console.log(`   Trying password: ${TEST_PASSWORD}`);
    
    const isMatch = await user.matchPassword(TEST_PASSWORD);
    
    if (isMatch) {
      console.log('✅ Password matches!');
    } else {
      console.log('❌ Password does NOT match!');
      console.log('\n🔧 Attempting to reset password...');
      
      // Reset password
      user.password = TEST_PASSWORD;
      user.skipPasswordHash = false; // Make sure it gets hashed
      await user.save();
      
      console.log('✅ Password has been reset');
      
      // Test again
      const userUpdated = await User.findOne({ email: TEST_EMAIL });
      const isMatchNow = await userUpdated.matchPassword(TEST_PASSWORD);
      
      if (isMatchNow) {
        console.log('✅ Password now matches!');
      } else {
        console.log('❌ Still not matching - there may be a deeper issue');
      }
    }

    // Check all login requirements
    console.log('\n📋 Login Requirements Check:');
    console.log(`   ✅ User exists: ${!!user}`);
    console.log(`   ${user.emailVerified ? '✅' : '❌'} Email verified: ${user.emailVerified}`);
    console.log(`   ${!user.blocked ? '✅' : '❌'} Not blocked: ${!user.blocked}`);
    console.log(`   ${!user.isBanned ? '✅' : '❌'} Not banned: ${!user.isBanned}`);
    console.log(`   ${isMatch ? '✅' : '❌'} Password matches: ${isMatch}`);

    const allChecks = user.emailVerified && !user.blocked && !user.isBanned && isMatch;
    
    if (allChecks) {
      console.log('\n✅ ALL CHECKS PASSED - Login should work!');
    } else {
      console.log('\n❌ Some checks failed - login will not work');
    }

    console.log('\n📝 Login Credentials:');
    console.log(`   Email: ${TEST_EMAIL}`);
    console.log(`   Password: ${TEST_PASSWORD}`);
    console.log(`   Login URL: http://localhost:5173/login`);

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

testLogin();
