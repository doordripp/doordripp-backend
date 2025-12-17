require('dotenv').config()
const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')
const User = require('../src/models/User')
const Product = require('../src/models/Product')
const { ALL_PRODUCTS } = require('../src/data/frontendProducts')

async function connectDB() {
  const uri = process.env.MONGO_URI
  try {
    await mongoose.connect(uri)
    console.log('MongoDB connected for seeding')
  } catch (err) {
    console.error('MongoDB connection error:', err.message)
    process.exit(1)
  }
}

async function seed() {
  await connectDB()

  try {
    // Create admin user
    const adminEmail = 'admin@doordripp.local'
    let admin = await User.findOne({ email: adminEmail })
    
    if (!admin) {
      // Don't hash password here - let the User model pre-save hook handle it
      admin = new User({
        name: 'Admin',
        email: adminEmail,
        password: 'adminpass', // Plain text - will be hashed by pre-save hook
        roles: ['admin'],
        emailVerified: true,
        termsAccepted: true
      })
      await admin.save()
      console.log('✅ Admin user created:', adminEmail)
      console.log('   Email: admin@doordripp.local')
      console.log('   Password: adminpass')
    } else {
      // Update existing admin to have admin role if not already set
      if (!admin.roles.includes('admin')) {
        admin.roles.push('admin')
        await admin.save()
        console.log('✅ Admin role updated for existing user')
      } else {
        console.log('✅ Admin user already exists with correct roles')
      }
    }

    // Import products
    console.log('🔄 Importing products...')
    let productsCreated = 0
    
    for (const productData of ALL_PRODUCTS) {
      const exists = await Product.findOne({ name: productData.name })
      if (!exists) {
        const product = new Product({
          name: productData.name,
          description: productData.description || `High-quality ${productData.name}`,
          price: productData.price,
          stock: Math.floor(Math.random() * 100) + 10, // Random stock 10-110
          category: productData.category || 'general',
          images: productData.images || []
        })
        await product.save()
        productsCreated++
      }
    }
    
    console.log(`✅ ${productsCreated} products created`)
    console.log('🎉 Seeding completed successfully!')
    
  } catch (error) {
    console.error('❌ Seeding error:', error)
  } finally {
    await mongoose.disconnect()
    console.log('📄 Database connection closed')
  }
}

// Run the seed function
seed().catch(err => {
  console.error('❌ Seed script failed:', err)
  process.exit(1)
})