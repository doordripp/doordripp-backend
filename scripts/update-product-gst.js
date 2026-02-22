/**
 * Update existing products with HSN/SAC codes and GST rates
 * Run: node scripts/update-product-gst.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('../src/models/Product');

const CATEGORY_GST_MAP = {
  clothing: { hsnSac: '6109', gstRate: 0 },
  apparel: { hsnSac: '6109', gstRate: 0 },
  fashion: { hsnSac: '6109', gstRate: 0 },
  electronics: { hsnSac: '8517', gstRate: 0 },
  mobile: { hsnSac: '8517', gstRate: 0 },
  gadgets: { hsnSac: '8517', gstRate: 0 },
  books: { hsnSac: '4901', gstRate: 0 },
  food: { hsnSac: '2106', gstRate: 0 },
  grocery: { hsnSac: '2106', gstRate: 0 },
  furniture: { hsnSac: '9403', gstRate: 0 },
  toys: { hsnSac: '9503', gstRate: 0 },
  footwear: { hsnSac: '6403', gstRate: 0 },
  beauty: { hsnSac: '3304', gstRate: 0 },
  personalcare: { hsnSac: '3304', gstRate: 0 }
};

const DEFAULT_GST = { hsnSac: '9973', gstRate: 0 };

async function connectDB() {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/doordripp');
  console.log('✅ Connected to MongoDB');
}

function normalizeCategory(category = '') {
  return String(category).toLowerCase().replace(/\s+/g, '').trim();
}

async function updateProducts() {
  const products = await Product.find({});
  console.log(`📦 Found ${products.length} products`);

  let updated = 0;

  for (const product of products) {
    const categoryKey = normalizeCategory(product.category);
    const mapping = CATEGORY_GST_MAP[categoryKey] || DEFAULT_GST;

    const needsUpdate = product.gstRate !== 0;

    if (needsUpdate) {
      product.hsnSac = mapping.hsnSac;
      product.gstRate = 0;

      await product.save();
      updated += 1;

      console.log(`✅ Updated: ${product.name} -> HSN ${product.hsnSac}, GST ${product.gstRate}%`);
    }
  }

  console.log(`✅ Updated ${updated} products`);
}

async function run() {
  try {
    await connectDB();
    await updateProducts();
  } catch (err) {
    console.error('❌ Update failed:', err.message);
  } finally {
    await mongoose.connection.close();
    console.log('👋 Disconnected from MongoDB');
  }
}

run();
