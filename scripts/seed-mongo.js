require('dotenv').config()
const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')
const User = require('../src/models/User')
const Product = require('../src/models/Product')
const ALL_PRODUCTS = []

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
        // Default sizes and colors for seeding if not provided
        const defaultSizes = productData.sizes || ['S', 'M', 'L', 'XL', 'XXL']
        const defaultColors = productData.colors || ['Black', 'White', 'Navy Blue', 'Gray']
        
        const product = new Product({
          name: productData.name,
          slug: productData.name.toLowerCase().replace(/ /g, '-').replace(/[^\w-]+/g, ''),
          description: productData.description || `High-quality ${productData.name} in various sizes and colors. Perfect for everyday wear.`,
          price: productData.price,
          originalPrice: productData.originalPrice || Math.round(productData.price * 1.2),
          discount: productData.discount || 0,
          stock: Math.floor(Math.random() * 100) + 10,
          category: productData.category || 'general',
          images: productData.images || [productData.image],
          sizes: defaultSizes,
          colors: defaultColors,
          rating: productData.rating || { rating: 4.5, reviews: 10 },
          gstRate: 0,
          hsnSac: '9973'
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