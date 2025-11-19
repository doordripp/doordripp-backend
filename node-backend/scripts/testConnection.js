require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const prisma = require('../src/config/prisma');

(async () => {
  try {
    await prisma.$connect();
    console.log('Connected to SQL database successfully');
    await prisma.$disconnect();
    process.exit(0);
  } catch (err) {
    console.error('Connection failed:');
    console.error(err && err.message ? err.message : err);
    process.exit(2);
  }
})();
