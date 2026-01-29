const mongoose = require('mongoose')
require('dotenv').config()

const dropUniqueIndex = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI)
    console.log('Connected to MongoDB')

    const db = mongoose.connection.db
    const collection = db.collection('reviews')

    // Get all indexes
    const indexes = await collection.indexes()
    console.log('\nCurrent indexes:')
    indexes.forEach(index => {
      console.log(`- ${JSON.stringify(index.key)} ${index.unique ? '(UNIQUE)' : ''}`)
    })

    // Drop the unique index on product + user
    try {
      await collection.dropIndex('product_1_user_1')
      console.log('\n✅ Successfully dropped unique index: product_1_user_1')
    } catch (err) {
      if (err.code === 27 || err.codeName === 'IndexNotFound') {
        console.log('\n⚠️  Index product_1_user_1 does not exist (already dropped)')
      } else {
        throw err
      }
    }

    // Get indexes after drop
    const newIndexes = await collection.indexes()
    console.log('\nIndexes after drop:')
    newIndexes.forEach(index => {
      console.log(`- ${JSON.stringify(index.key)} ${index.unique ? '(UNIQUE)' : ''}`)
    })

    console.log('\n✅ Index cleanup completed')
    process.exit(0)
  } catch (err) {
    console.error('Error:', err)
    process.exit(1)
  }
}

dropUniqueIndex()
