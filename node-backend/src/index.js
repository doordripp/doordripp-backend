require('dotenv').config();
const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const cookieParser = require('cookie-parser');
// Prisma handles DB connection via `src/config/prisma.js`
// Passport (OAuth strategies)
const passport = require('./config/passport');

const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const orderRoutes = require('./routes/orders');
const frontendProductRoutes = require('./routes/frontendProducts');
const cartRoutes = require('./routes/cart');
const healthRoutes = require('./routes/health');

const app = express();
const PORT = process.env.PORT || 4000;

// Database client is initialized lazily by Prisma when first used

// Middlewares
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const corsOptions = {
  origin: FRONTEND_URL,
  credentials: true,
};
app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());
app.use(morgan('dev'));
// Initialize passport (strategies are configured in `src/config/passport.js`)
app.use(passport.initialize());

// Connect to MongoDB (if configured)
try {
  const connectDB = require('./config/db');
  connectDB().catch(err => console.error('DB connect error', err));
} catch (e) {
  console.warn('No DB connector found:', e.message || e);
}

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/frontend/products', frontendProductRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/health', healthRoutes);

// Health
app.get('/', (req, res) => res.json({ ok: true, version: '0.1.0' }));

// Serve React build if present
const path = require('path');
const fs = require('fs');
const clientBuildPath = path.join(__dirname, '../client-build');
const frontendBuildPath = path.join(__dirname, '../frontend/build');
const staticPath = fs.existsSync(clientBuildPath) ? clientBuildPath : (fs.existsSync(frontendBuildPath) ? frontendBuildPath : null);
if (staticPath) {
  app.use(express.static(staticPath));
  // SPA fallback for non-API routes
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(staticPath, 'index.html'));
  });
}

// Serve uploaded files (avatars, etc.) from ./src/public/uploads -> accessible at /uploads
const uploadsPath = path.join(__dirname, 'public');
if (fs.existsSync(uploadsPath)) {
  app.use('/uploads', express.static(path.join(uploadsPath, 'uploads')));
}

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

app.listen(PORT, () => {
  console.log(`Doordripp Node backend listening on port ${PORT}`);
});
