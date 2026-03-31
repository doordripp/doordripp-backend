/**
 * Update all products delivery cost
 * Run: node scripts/update-product-delivery-cost.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('../src/models/Product');

const TARGET_DELIVERY_COST = 60;

async function connectDB() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGO_URI or MONGODB_URI not found in environment');
  }
  await mongoose.connect(uri);
  console.log('Connected to MongoDB');
}

async function updateAllProducts() {
  const result = await Product.updateMany(
    {},
    { $set: { deliveryCost: TARGET_DELIVERY_COST } }
  );

  console.log(`Matched: ${result.matchedCount}, Modified: ${result.modifiedCount}`);
}

async function run() {
  try {
    await connectDB();
    await updateAllProducts();
    console.log(`All products deliveryCost set to ${TARGET_DELIVERY_COST}`);
  } catch (err) {
    console.error('Update failed:', err.message);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
    console.log('Disconnected from MongoDB');
  }
}

run();
