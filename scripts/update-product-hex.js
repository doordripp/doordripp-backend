require('dotenv').config()
const mongoose = require('mongoose')
const Product = require('../src/models/Product')

async function updateProducts() {
  try {
    const uri = process.env.MONGO_URI
    await mongoose.connect(uri)
    console.log('Connected to MongoDB')

    // Update first few products with hex colors to demonstrate the swatch fix
    const products = await Product.find({}).limit(5)
    
    for (const product of products) {
      product.colors = ['#FFFFFF', '#0000FF', '#FF0000', '#000000']
      await product.save()
    }

    console.log(`Updated ${products.length} products with hex color codes for visual testing.`)
    
  } catch (error) {
    console.error('Error updating products:', error)
  } finally {
    await mongoose.disconnect()
  }
}

updateProducts()
