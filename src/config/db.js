const mongoose = require('mongoose');
const dns = require('dns');
const logger = require('../utils/logger');

let configuredDnsServers = false;
let isListenersAttached = false;

function configureAtlasDns() {
  try {
    if (!configuredDnsServers) {
      dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4', '1.0.0.1']);
      configuredDnsServers = true;
      logger.info('Configured public DNS servers (8.8.8.8, 1.1.1.1) for MongoDB Atlas SRV resolution');
    }
  } catch (err) {
    logger.warn('Unable to set DNS servers for MongoDB Atlas lookup:', err?.message || err);
  }
}

function attachConnectionListeners() {
  if (isListenersAttached) return;
  isListenersAttached = true;

  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected. Reconnecting...');
  });

  mongoose.connection.on('reconnected', () => {
    logger.info('MongoDB reconnected successfully.');
  });

  mongoose.connection.on('error', (err) => {
    logger.error('MongoDB runtime connection error:', err);
  });
}

const connectDB = async () => {
  const uri = process.env.MONGO_URI || process.env.DATABASE_URL || "";

  if (!uri) {
    logger.warn("MONGO_URI not set. Skipping MongoDB connection.");
    return;
  }

  attachConnectionListeners();

  if (uri.startsWith('mongodb+srv://')) {
    configureAtlasDns();
  }

  const connectOptions = {
    serverSelectionTimeoutMS: 30000,
    connectTimeoutMS: 30000,
    socketTimeoutMS: 45000,
    family: 4,
    maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE || 10),
    minPoolSize: Number(process.env.MONGO_MIN_POOL_SIZE || 2),
    retryWrites: true,
    retryReads: true,
  };

  try {
    await mongoose.connect(uri, connectOptions);
    logger.info("MongoDB connected successfully");
  } catch (err) {
    const isDnsError = err?.code === 'ECONNREFUSED' || err?.syscall === 'querySrv' || err?.message?.includes('querySrv');

    if (isDnsError) {
      const fallbackUri = process.env.MONGO_FALLBACK_URI || (
        uri.includes('cluster0.l0krb9x.mongodb.net') ? (
          `mongodb://${uri.match(/mongodb\+srv:\/\/([^@]+)@/)?.[1] || ''}@ac-jadoofl-shard-00-00.l0krb9x.mongodb.net:27017,ac-jadoofl-shard-00-01.l0krb9x.mongodb.net:27017,ac-jadoofl-shard-00-02.l0krb9x.mongodb.net:27017/doordripp?ssl=true&replicaSet=atlas-agoh5s-shard-0&authSource=admin&appName=Cluster0`
        ) : null
      );

      if (fallbackUri) {
        logger.warn("MongoDB SRV DNS resolution failed. Attempting fallback connection string...");
        try {
          await mongoose.connect(fallbackUri, connectOptions);
          logger.info("MongoDB connected successfully via fallback connection");
          return;
        } catch (fallbackErr) {
          logger.error("MongoDB fallback connection also failed:", fallbackErr);
        }
      }
    }

    logger.error("MongoDB connection error:", err);
    throw err;
  }
};

const disconnectDB = async () => {
  try {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
      logger.info("MongoDB disconnected gracefully.");
    }
  } catch (err) {
    logger.error("Error disconnecting MongoDB:", err);
  }
};

module.exports = connectDB;
module.exports.connectDB = connectDB;
module.exports.disconnectDB = disconnectDB;
