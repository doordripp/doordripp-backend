#!/usr/bin/env node
/**
 * Script to verify/fix the delivery partner test user
 * Usage: node scripts/verify-delivery-partner.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/models/User');

const TEST_EMAIL = 'delivery.partner@test.com';

async function verifyUser() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/doordripp');
    console.log('✅ Connected to MongoDB');

    // Find the user
    const user = await User.findOne({ email: TEST_EMAIL });
    
    if (!user) {
      console.log('\n❌ User not found with email:', TEST_EMAIL);
      console.log('   Please run create-delivery-partner.js first');
      await mongoose.connection.close();
      process.exit(1);
    }

    console.log('\n📋 Current User Details:');
    console.log(`   Email: ${user.email}`);
    console.log(`   Name: ${user.name}`);
    console.log(`   Phone: ${user.phone}`);
    console.log(`   Roles: ${user.roles.join(', ')}`);
    console.log(`   Email Verified: ${user.emailVerified}`);
    console.log(`   Phone Verified: ${user.phoneVerified}`);
    console.log(`   Blocked: ${user.blocked}`);
    console.log(`   Banned: ${user.isBanned || false}`);
    console.log(`   Terms Accepted: ${user.termsAccepted}`);
    console.log(`   User ID: ${user._id}`);

    // Check if any fixes are needed
    let needsUpdate = false;
    const updates = {};

    if (!user.emailVerified) {
      console.log('\n⚠️  Email not verified - fixing...');
      updates.emailVerified = true;
      needsUpdate = true;
    }

    if (!user.roles.includes('delivery_partner')) {
      console.log('\n⚠️  Delivery partner role missing - adding...');
      updates.roles = ['delivery_partner'];
      needsUpdate = true;
    }

    if (user.blocked) {
      console.log('\n⚠️  User is blocked - unblocking...');
      updates.blocked = false;
      needsUpdate = true;
    }

    if (user.isBanned) {
      console.log('\n⚠️  User is banned - unbanning...');
      updates.isBanned = false;
      updates.banReason = null;
      updates.bannedAt = null;
      updates.bannedBy = null;
      needsUpdate = true;
    }

    if (needsUpdate) {
      await User.findByIdAndUpdate(user._id, updates);
      console.log('✅ User updated successfully!');
      
      // Fetch updated user
      const updatedUser = await User.findById(user._id);
      console.log('\n📋 Updated User Details:');
      console.log(`   Email Verified: ${updatedUser.emailVerified}`);
      console.log(`   Roles: ${updatedUser.roles.join(', ')}`);
      console.log(`   Blocked: ${updatedUser.blocked}`);
      console.log(`   Banned: ${updatedUser.isBanned || false}`);
    } else {
      console.log('\n✅ User is correctly configured!');
    }

    console.log('\n📝 Login Credentials:');
    console.log(`   Email: delivery.partner@test.com`);
    console.log(`   Password: Delivery@123`);
    console.log('\n✅ You should now be able to login!');

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    await mongoose.connection.close();
    process.exit(1);
  }
}

verifyUser();
