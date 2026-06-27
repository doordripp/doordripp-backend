const mongoose = require('mongoose');
const dns = require('dns');
const logger = require('../utils/logger');

let configuredDnsServers = false;

function configureAtlasDns() {
  const uri = process.env.MONGO_URI || process.env.DATABASE_URL || '';

  if (!uri.startsWith('mongodb+srv://') || configuredDnsServers) {
    return;
  }

  try {
    dns.setServers(['1.1.1.1', '8.8.8.8']);
    configuredDnsServers = true;
    logger.info('Configured public DNS servers for MongoDB Atlas SRV resolution');
  } catch (err) {
    logger.warn('Unable to override DNS servers for MongoDB Atlas lookup:', err?.message || err);
  }
}

const connectDB = async () => {
  const uri = process.env.MONGO_URI || process.env.DATABASE_URL || "";

  if (!uri) {
    logger.warn("MONGO_URI not set. Skipping MongoDB connection.");
    return;
  }

  try {
    configureAtlasDns();

    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 30000,
      connectTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      family: 4,
      maxPoolSize: 10,
      retryWrites: true,
      retryReads: true,
    });
    logger.info("MongoDB connected");
  } catch (err) {
    logger.error("MongoDB connection error:", err);
    throw err;
  }
};

module.exports = connectDB;
