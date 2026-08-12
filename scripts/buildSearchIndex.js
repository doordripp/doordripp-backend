const mongoose = require('mongoose');
require('../src/config/db')();
const Product = require('../src/models/Product');

async function run() {
  try {
    console.log('Building search index...');
    try {
      await Product.collection.dropIndex('product_search_index');
      console.log('Dropped existing text index.');
    } catch (e) {
      console.log('No existing text index to drop, or error dropping: ' + e.message);
    }
    
    // Mongoose will auto-create on init, but we can sync indexes explicitly
    await Product.syncIndexes();
    console.log('Indexes synced successfully.');
    
    const indexes = await Product.collection.indexes();
    console.log('Current indexes:', indexes);
  } catch (err) {
    console.error('Error building search index:', err);
  } finally {
    mongoose.disconnect();
    console.log('Disconnected.');
    process.exit(0);
  }
}

run();
