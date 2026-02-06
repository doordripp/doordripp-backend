/**
 * Test Script: Invoice Generation
 * 
 * This script tests the invoice generation system with sample order data.
 * Run: node scripts/test-invoice-generation.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Order = require('../src/models/Order');
const Product = require('../src/models/Product');
const User = require('../src/models/User');
const InvoiceService = require('../src/services/invoiceService');

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/doordripp');
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    process.exit(1);
  }
}

async function createTestProduct() {
  console.log('\n📦 Creating test product...');
  
  const product = await Product.create({
    name: 'Test Product - Premium Cotton T-Shirt',
    slug: 'test-product-' + Date.now(),
    description: 'High quality cotton t-shirt for testing invoice generation',
    price: 999,
    originalPrice: 1499,
    discount: 33,
    stock: 100,
    category: 'Clothing',
    subcategory: 'T-Shirts',
    images: ['https://placeholder.com/300'],
    hsnSac: '6109', // HSN code for T-shirts
    gstRate: 12, // 12% GST for clothing
    isNewArrival: true
  });

  console.log(`✅ Created product: ${product.name} (ID: ${product._id})`);
  return product;
}

async function createTestUser() {
  console.log('\n👤 Creating test user...');
  
  // Check if test user exists
  let user = await User.findOne({ email: 'test-invoice@example.com' });
  
  if (!user) {
    user = await User.create({
      name: 'Test Customer',
      email: 'test-invoice@example.com',
      password: 'hashedpassword123', // Not used for testing
      phone: '+91-9876543210',
      roles: ['customer']
    });
    console.log(`✅ Created user: ${user.name} (ID: ${user._id})`);
  } else {
    console.log(`✅ Using existing user: ${user.name} (ID: ${user._id})`);
  }
  
  return user;
}

async function createTestOrder(customer, product) {
  console.log('\n🛒 Creating test order...');
  
  const order = await Order.create({
    customer: customer._id,
    items: [
      {
        product: product._id,
        name: product.name,
        price: product.price,
        quantity: 2
      }
    ],
    total: product.price * 2,
    status: 'confirmed',
    payment: {
      method: 'online',
      status: 'paid',
      transactionId: 'test_txn_' + Date.now()
    },
    shippingAddress: {
      name: customer.name,
      phone: customer.phone || '+91-9876543210',
      email: customer.email,
      addressLine1: '123 Test Street',
      addressLine2: 'Near Test Market',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400001',
      country: 'India'
    },
    billingAddress: {
      name: customer.name,
      phone: customer.phone || '+91-9876543210',
      email: customer.email,
      addressLine1: '123 Test Street',
      addressLine2: 'Near Test Market',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400001',
      country: 'India'
    }
  });

  console.log(`✅ Created order: ${order._id}`);
  console.log(`   Items: ${order.items.length}`);
  console.log(`   Total: ₹${order.total}`);
  console.log(`   Payment: ${order.payment.method} - ${order.payment.status}`);
  
  return order;
}

async function testInvoiceGeneration(orderId) {
  console.log('\n📄 Testing invoice generation...');
  console.log(`   Order ID: ${orderId}`);
  
  try {
    const result = await InvoiceService.generateInvoice(orderId.toString());
    
    console.log('\n✅ Invoice generated successfully!');
    console.log(`   Invoice Number: ${result.invoice.invoiceNumber}`);
    console.log(`   Invoice ID: ${result.invoice._id}`);
    console.log(`   Financial Year: ${result.invoice.financialYear}`);
    console.log(`   Taxable Amount: ₹${result.invoice.taxableAmount}`);
    console.log(`   CGST: ₹${result.invoice.cgstAmount}`);
    console.log(`   SGST: ₹${result.invoice.sgstAmount}`);
    console.log(`   IGST: ₹${result.invoice.igstAmount}`);
    console.log(`   Total Amount: ₹${result.invoice.totalAmount}`);
    console.log(`   PDF Path: ${result.pdfPath}`);
    console.log(`   PDF URL: ${result.pdfUrl}`);
    console.log(`   Items: ${result.items.length}`);
    
    // Display item details
    result.items.forEach((item, index) => {
      console.log(`\n   Item ${index + 1}:`);
      console.log(`      Product: ${item.productName}`);
      console.log(`      HSN: ${item.hsnSac}`);
      console.log(`      Quantity: ${item.quantity}`);
      console.log(`      Unit Price: ₹${item.unitPrice}`);
      console.log(`      Taxable Value: ₹${item.taxableValue}`);
      console.log(`      GST Rate: ${item.gstRate}%`);
      console.log(`      CGST: ₹${item.cgst} (${item.cgstRate}%)`);
      console.log(`      SGST: ₹${item.sgst} (${item.sgstRate}%)`);
      console.log(`      Total: ₹${item.totalPrice}`);
    });
    
    return result;
  } catch (error) {
    console.error('\n❌ Invoice generation failed:', error.message);
    throw error;
  }
}

async function testDuplicatePrevention(orderId) {
  console.log('\n🔒 Testing duplicate invoice prevention...');
  
  try {
    await InvoiceService.generateInvoice(orderId.toString());
    console.log('❌ Duplicate prevention failed - invoice was generated again!');
  } catch (error) {
    if (error.message.includes('already exists')) {
      console.log('✅ Duplicate prevention working correctly');
    } else {
      console.error('❌ Unexpected error:', error.message);
    }
  }
}

async function cleanup(product, user, order) {
  console.log('\n🧹 Cleanup test data? (y/N)');
  
  // For automated testing, skip cleanup prompt
  // In manual testing, you can add readline to prompt user
  const shouldCleanup = process.env.AUTO_CLEANUP === 'true';
  
  if (shouldCleanup) {
    console.log('🧹 Cleaning up test data...');
    
    if (product) {
      await Product.findByIdAndDelete(product._id);
      console.log('   Deleted test product');
    }
    
    // Don't delete user - might be used for multiple tests
    // if (user) {
    //   await User.findByIdAndDelete(user._id);
    //   console.log('   Deleted test user');
    // }
    
    if (order) {
      await Order.findByIdAndDelete(order._id);
      console.log('   Deleted test order');
    }
    
    // Note: Invoice and InvoiceItem records are kept for verification
    console.log('   ℹ️  Invoice records kept for verification');
    console.log('   ℹ️  You can manually delete them from database if needed');
  } else {
    console.log('   ℹ️  Test data preserved for manual inspection');
    console.log('   ℹ️  To auto-cleanup, set AUTO_CLEANUP=true');
  }
}

async function runTests() {
  console.log('========================================');
  console.log('  Invoice Generation Test Suite');
  console.log('========================================');
  
  let product, user, order;
  
  try {
    await connectDB();
    
    // Create test data
    product = await createTestProduct();
    user = await createTestUser();
    order = await createTestOrder(user, product);
    
    // Test invoice generation
    const result = await testInvoiceGeneration(order._id);
    
    // Test duplicate prevention
    await testDuplicatePrevention(order._id);
    
    console.log('\n========================================');
    console.log('  ✅ All Tests Passed!');
    console.log('========================================');
    console.log('\nNext Steps:');
    console.log('1. Check the generated PDF at:', result.pdfPath);
    console.log('2. Verify invoice in database (Invoice collection)');
    console.log('3. Test with real orders in production');
    console.log('4. Configure company GSTIN in .env file');
    
    await cleanup(product, user, order);
    
  } catch (error) {
    console.error('\n❌ Test suite failed:', error);
    
    // Attempt cleanup on error
    await cleanup(product, user, order);
  } finally {
    await mongoose.connection.close();
    console.log('\n👋 Disconnected from MongoDB');
  }
}

// Run tests
runTests();
