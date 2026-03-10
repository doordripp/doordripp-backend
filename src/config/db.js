const mongoose = require("mongoose");
const logger = require('../utils/logger');

const connectDB = async () => {
  const uri = process.env.MONGO_URI || process.env.DATABASE_URL || "";

  if (!uri) {
    logger.warn("MONGO_URI not set. Skipping MongoDB connection.");
    return;
  }

  try {
    await mongoose.connect(uri); // No deprecated options
    logger.info("MongoDB connected");
  } catch (err) {
    logger.error("MongoDB connection error:", err);
    throw err;
  }
};

module.exports = connectDB;
