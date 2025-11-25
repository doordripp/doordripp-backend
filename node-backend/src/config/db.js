const mongoose = require("mongoose");

const connectDB = async () => {
  const uri = process.env.MONGO_URI || process.env.DATABASE_URL || "";

  if (!uri) {
    console.warn("MONGO_URI not set. Skipping MongoDB connection.");
    return;
  }

  try {
    await mongoose.connect(uri); // No deprecated options
    console.log("MongoDB connected");
  } catch (err) {
    console.error("MongoDB connection error:", err.message || err);
    throw err;
  }
};

module.exports = connectDB;
