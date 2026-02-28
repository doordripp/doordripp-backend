#!/usr/bin/env node
/**
 * Script to create a test delivery partner user
 * Usage: node scripts/create-delivery-partner.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../src/models/User');

const DELIVERY_PARTNER_DATA = {
  name: 'Test Delivery Partner',
  email: 'delivery.partner@test.com',
  phone: '+919876543210',
  password: 'Delivery@123',
  roles: ['delivery_partner'],
  emailVerified: true,
  phoneVerified: true,
  termsAccepted: true
};

async function createDeliveryPartner() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/doordripp');
    console.log('✅ Connected to MongoDB');

    // Check if user already exists
    const existingUser = await User.findOne({ email: DELIVERY_PARTNER_DATA.email });
    
    if (existingUser) {
      console.log('\n⚠️  User already exists with this email!');
      console.log(`   Email: ${existingUser.email}`);
      console.log(`   Roles: ${existingUser.roles.join(', ')}`);
      console.log(`   ID: ${existingUser._id}`);
      
      // Ask if we should update to delivery_partner role
      if (!existingUser.roles.includes('delivery_partner')) {
        console.log('\n🔄 Updating user role to include delivery_partner...');
        existingUser.roles = ['delivery_partner'];
        await existingUser.save();
        console.log('✅ User role updated to delivery_partner');
      }
      
      console.log('\n📝 Login Credentials:');
      console.log(`   Email: ${DELIVERY_PARTNER_DATA.email}`);
      console.log(`   Password: ${DELIVERY_PARTNER_DATA.password}`);
      
      await mongoose.connection.close();
      return;
    }

    // Hash password
    console.log('\n🔐 Hashing password...');
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(DELIVERY_PARTNER_DATA.password, salt);

    // Create user
    console.log('👤 Creating delivery partner user...');
    const user = await User.create({
      ...DELIVERY_PARTNER_DATA,
      password: hashedPassword
    });

    console.log('\n✅ Delivery partner user created successfully!');
    console.log('\n📝 Login Credentials:');
    console.log(`   Email: ${user.email}`);
    console.log(`   Password: ${DELIVERY_PARTNER_DATA.password}`);
    console.log(`   Name: ${user.name}`);
    console.log(`   Phone: ${user.phone}`);
    console.log(`   Roles: ${user.roles.join(', ')}`);
    console.log(`   User ID: ${user._id}`);
    console.log('\n💡 Next Steps:');
    console.log('   1. Log in with the credentials above');
    console.log('   2. An admin needs to assign delivery zones to this user');
    console.log('   3. Use Admin Panel → Users → Assign Manager to assign zones');

    await mongoose.connection.close();
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error creating delivery partner:', error.message);
    if (error.code === 11000) {
      console.error('   Duplicate key error - user with this email/phone already exists');
    }
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Run the script
createDeliveryPartner();
