/**
 * Make User Admin Script
 * Usage: node scripts/make-user-admin.js <email>
 * Example: node scripts/make-user-admin.js ksarvesht@gmail.com
 */

require('dotenv').config();
const mongoose = require('mongoose');

async function makeAdmin(email) {
  try {
    console.log(`🚀 Connecting to MongoDB...\n`);
    
    const uri = process.env.MONGO_URI;
    if (!uri) {
      console.error('❌ MONGO_URI not set in .env file');
      process.exit(1);
    }

    await mongoose.connect(uri);
    console.log('✅ Connected to MongoDB\n');

    // Import User model
    const User = require('../src/models/User');

    // Find user by email
    const user = await User.findOne({ email });

    if (!user) {
      console.error(`❌ User not found: ${email}`);
      process.exit(1);
    }

    console.log(`📧 Found user: ${user.name} (${user.email})`);
    console.log(`   Current roles: [${user.roles.join(', ') || 'none'}]`);

    // Add ADMIN role if not already present
    if (user.roles.includes('ADMIN')) {
      console.log(`\n✅ User is already an ADMIN!`);
    } else {
      user.roles.push('ADMIN');
      await user.save();
      console.log(`\n✅ Successfully added ADMIN role!`);
      console.log(`   New roles: [${user.roles.join(', ')}]`);
    }

    await mongoose.disconnect();
    console.log('\n🎉 Done! User is now an admin.\n');
    process.exit(0);

  } catch (error) {
    console.error('❌ Error:', error.message);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Get email from command line argument
const email = process.argv[2];

if (!email) {
  console.error('❌ Please provide an email address');
  console.log('Usage: node scripts/make-user-admin.js <email>');
  console.log('Example: node scripts/make-user-admin.js ksarvesht@gmail.com');
  process.exit(1);
}

makeAdmin(email);
