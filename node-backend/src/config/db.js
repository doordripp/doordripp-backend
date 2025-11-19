// Deprecated MongoDB connector placeholder.
// This project now uses Prisma with a SQL database. Use `src/config/prisma.js` instead.

const connectDB = async () => {
  console.warn('connectDB() is deprecated. This project uses Prisma/SQL now.');
  return;
};

module.exports = connectDB;
