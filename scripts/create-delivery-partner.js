#!/usr/bin/env node
/**
 * Script to create a test delivery partner user.
 * Usage: node scripts/create-delivery-partner.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/models/User');

const DELIVERY_PARTNER_DATA = {
  name: 'Test Delivery Partner',
  email: 'delivery.partner@test.com',
  phone: '+919876543210',
  password: 'Delivery@123',
  roles: ['delivery_partner'],
  emailVerified: true,
  phoneVerified: true,
  termsAccepted: true,
  isPasswordSet: true
};

async function createDeliveryPartner() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/doordripp');
    console.log('Connected to MongoDB');

    const existingUser = await User.findOne({ email: DELIVERY_PARTNER_DATA.email });

    if (existingUser) {
      console.log('\nUser already exists with this email.');
      console.log(`   Email: ${existingUser.email}`);
      console.log(`   Roles: ${existingUser.roles.join(', ')}`);
      console.log(`   ID: ${existingUser._id}`);

      if (!existingUser.roles.includes('delivery_partner')) {
        console.log('\nUpdating user role to include delivery_partner...');
        existingUser.roles = ['delivery_partner'];
        await existingUser.save();
        console.log('User role updated to delivery_partner');
      }

      if (!existingUser.isPasswordSet) {
        existingUser.isPasswordSet = true;
        await existingUser.save();
        console.log('Marked existing user as password-enabled');
      }

      console.log('\nLogin credentials:');
      console.log(`   Email: ${DELIVERY_PARTNER_DATA.email}`);
      console.log(`   Password: ${DELIVERY_PARTNER_DATA.password}`);

      await mongoose.connection.close();
      return;
    }

    console.log('Creating delivery partner user...');
    const user = await User.create(DELIVERY_PARTNER_DATA);

    console.log('\nDelivery partner user created successfully.');
    console.log('\nLogin credentials:');
    console.log(`   Email: ${user.email}`);
    console.log(`   Password: ${DELIVERY_PARTNER_DATA.password}`);
    console.log(`   Name: ${user.name}`);
    console.log(`   Phone: ${user.phone}`);
    console.log(`   Roles: ${user.roles.join(', ')}`);
    console.log(`   User ID: ${user._id}`);
    console.log('\nNext steps:');
    console.log('   1. Log in with the credentials above');
    console.log('   2. An admin needs to assign delivery zones to this user');
    console.log('   3. Use Admin Panel > Users > Assign Manager to assign zones');

    await mongoose.connection.close();
    console.log('\nScript completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('\nError creating delivery partner:', error.message);
    if (error.code === 11000) {
      console.error('   Duplicate key error - user with this email/phone already exists');
    }
    await mongoose.connection.close();
    process.exit(1);
  }
}

createDeliveryPartner();
