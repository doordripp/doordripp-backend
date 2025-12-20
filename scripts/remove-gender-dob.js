// One-time migration: unset gender and dob fields from all users and pending users
// Usage:
//   cd node-backend
//   node scripts/remove-gender-dob.js

require('dotenv').config();
const mongoose = require('mongoose');

async function run() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('❌ MONGO_URI not set');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('✅ Connected to MongoDB');

  // Lazy load models to avoid require issues
  const User = require('../src/models/User');
  const PendingUser = require('../src/models/PendingUser');

  // Unset gender/dob from User collection
  const userResult = await User.updateMany(
    { $or: [{ gender: { $exists: true } }, { dob: { $exists: true } }] },
    { $unset: { gender: '', dob: '' } }
  );
  console.log(`🧹 Users cleaned: matched=${userResult.matchedCount}, modified=${userResult.modifiedCount}`);

  // Unset gender/dob from PendingUser collection
  const pendingResult = await PendingUser.updateMany(
    { $or: [{ gender: { $exists: true } }, { dob: { $exists: true } }] },
    { $unset: { gender: '', dob: '' } }
  );
  console.log(`🧹 PendingUsers cleaned: matched=${pendingResult.matchedCount}, modified=${pendingResult.modifiedCount}`);

  await mongoose.disconnect();
  console.log('✅ Done and disconnected');
}

run().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
