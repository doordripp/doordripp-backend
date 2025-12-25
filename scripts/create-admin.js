/**
 * Create Admin User Script for MongoDB
 * Run: node scripts/create-admin.js
 * 
 * Creates an admin user for the DoorDripp admin panel
 */

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@doordripp.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@123';
const ADMIN_NAME = process.env.ADMIN_NAME || 'Admin User';

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

async function createAdmin() {
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

    // Check if admin already exists
    const existingAdmin = await User.findOne({ email: ADMIN_EMAIL });

    if (existingAdmin) {
      console.log('⚠️  Admin user already exists!');
      console.log(`   Email: ${ADMIN_EMAIL}`);
      
      // Update to admin role if not already
      if (!existingAdmin.roles.includes('ADMIN')) {
        existingAdmin.roles.push('ADMIN');
        await existingAdmin.save();
        console.log('   ✅ Updated user to ADMIN role');
      } else {
        console.log('   Already has ADMIN role');
      }

      // Verify email if not already verified
      if (!existingAdmin.emailVerified) {
        existingAdmin.emailVerified = true;
        await existingAdmin.save();
        console.log('   ✅ Email verified');
      } else {
        console.log('   Email already verified');
      }
    } else {
      // Hash password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, salt);

      // Create admin user
      const admin = await User.create({
        name: ADMIN_NAME,
        email: ADMIN_EMAIL,
        password: hashedPassword,
        emailVerified: true,
        roles: ['ADMIN'],
        blocked: false,
        termsAccepted: true
      });

      console.log('✅ Admin user created successfully!\n');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('📧 Email:    ', ADMIN_EMAIL);
      console.log('🔑 Password: ', ADMIN_PASSWORD);
      console.log('👤 Name:     ', ADMIN_NAME);
      console.log('🆔 ID:       ', admin._id);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    }
    
    console.log('🔐 Login at: http://localhost:5173/login');
    console.log('📊 Admin Panel: http://localhost:5173/admin');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');
  }
}

createAdmin();
