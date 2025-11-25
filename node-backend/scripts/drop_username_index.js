require('dotenv').config();
const mongoose = require('mongoose');

async function run() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGO_URI not set');
    process.exit(1);
  }

  try {
    await mongoose.connect(uri, { dbName: process.env.MONGO_DB_NAME || undefined });
    const db = mongoose.connection.db;
    const coll = db.collection('users');
    const indexes = await coll.indexes();
    console.log('Indexes before:', indexes.map(i => i.name));
    const idx = indexes.find(i => i.name === 'username_1');
    if (idx) {
      await coll.dropIndex('username_1');
      console.log('Dropped index username_1');
    } else {
      console.log('Index username_1 not found — nothing to drop');
    }
  } catch (e) {
    console.error('Error while dropping index:', e);
  } finally {
    await mongoose.disconnect();
  }
}

run();
