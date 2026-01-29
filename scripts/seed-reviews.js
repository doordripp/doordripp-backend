const mongoose = require('mongoose')
require('dotenv').config()

const Review = require('../src/models/Review')
const Product = require('../src/models/Product')
const User = require('../src/models/User')

// Connect to MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || process.env.DATABASE_URL || 'mongodb://localhost:27017/doordripp')
    console.log('Connected to MongoDB')
  } catch (error) {
    console.error('MongoDB connection error:', error)
    process.exit(1)
  }
}

// Sample review data
const sampleReviews = [
  {
    rating: 5,
    title: 'Excellent Quality!',
    comment: 'This product exceeded my expectations. The material is premium and the fit is perfect. I ordered this during the sale and got great value for money. Highly recommend to anyone looking for quality clothing.',
    helpfulVotes: 15,
    isVerifiedPurchase: true
  },
  {
    rating: 4,
    title: 'Good product, fast delivery',
    comment: 'Overall satisfied with the purchase. The product quality is good and delivery was quick. Only minor issue is that the color was slightly different from the website photos, but still acceptable.',
    helpfulVotes: 8,
    isVerifiedPurchase: true
  },
  {
    rating: 3,
    title: 'Average quality',
    comment: 'The product is okay but nothing extraordinary. For the price point, I expected a bit more quality. The stitching could be better and the material feels a bit thin.',
    helpfulVotes: 3,
    isVerifiedPurchase: false
  },
  {
    rating: 5,
    title: 'Love it! Will buy again',
    comment: 'Amazing product! The design is beautiful and the quality is top-notch. Customer service was also very helpful when I had questions about sizing. Definitely buying more from this brand.',
    helpfulVotes: 22,
    isVerifiedPurchase: true
  },
  {
    rating: 2,
    title: 'Not as expected',
    comment: 'The product quality is disappointing. The color faded after just one wash and the fabric feels cheap. Would not recommend this to others.',
    helpfulVotes: 1,
    unhelpfulVotes: 2,
    isVerifiedPurchase: true
  },
  {
    rating: 4,
    title: 'Good value for money',
    comment: 'For the price, this is a decent product. The fit is good and the material is comfortable. Shipping was fast and packaging was neat.',
    helpfulVotes: 6,
    isVerifiedPurchase: true
  }
]

// Function to create sample reviews
const seedReviews = async () => {
  try {
    // Get some existing products and users
    const products = await Product.find().limit(5)
    const users = await User.find().limit(10)

    if (products.length === 0) {
      console.log('No products found. Please seed products first.')
      return
    }

    if (users.length === 0) {
      console.log('No users found. Please create some users first.')
      return
    }

    console.log(`Found ${products.length} products and ${users.length} users`)

    // Clear existing reviews
    await Review.deleteMany({})
    console.log('Cleared existing reviews')

    const reviewsToCreate = []

    // Create reviews for each product
    for (const product of products) {
      // Create 2-4 reviews per product
      const numReviews = Math.floor(Math.random() * 3) + 2
      const shuffledReviews = [...sampleReviews].sort(() => 0.5 - Math.random())
      const shuffledUsers = [...users].sort(() => 0.5 - Math.random())

      for (let i = 0; i < numReviews && i < shuffledReviews.length && i < shuffledUsers.length; i++) {
        const reviewData = shuffledReviews[i]
        const user = shuffledUsers[i]

        reviewsToCreate.push({
          ...reviewData,
          product: product._id,
          user: user._id,
          createdAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000), // Random date within last 30 days
          deviceInfo: {
            platform: Math.random() > 0.5 ? 'desktop' : 'mobile',
            browser: ['Chrome', 'Firefox', 'Safari', 'Edge'][Math.floor(Math.random() * 4)]
          }
        })
      }
    }

    // Insert reviews
    const createdReviews = await Review.insertMany(reviewsToCreate)
    console.log(`Created ${createdReviews.length} reviews`)

    // Update product ratings
    for (const product of products) {
      const productReviews = await Review.find({ product: product._id, isApproved: true, isDeleted: false })
      
      if (productReviews.length > 0) {
        const avgRating = productReviews.reduce((sum, review) => sum + review.rating, 0) / productReviews.length
        
        await Product.findByIdAndUpdate(product._id, {
          rating: {
            rating: parseFloat(avgRating.toFixed(1)),
            reviews: productReviews.length
          }
        })
        
        console.log(`Updated product ${product.name} rating to ${avgRating.toFixed(1)} with ${productReviews.length} reviews`)
      }
    }

    console.log('✅ Review seeding completed successfully!')

  } catch (error) {
    console.error('Error seeding reviews:', error)
  }
}

// Main execution
const main = async () => {
  await connectDB()
  await seedReviews()
  mongoose.disconnect()
  console.log('Database connection closed')
}

main().catch(console.error)