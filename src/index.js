require('dotenv').config();
const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const cookieParser = require('cookie-parser');
// Passport (OAuth strategies)
const passport = require('./config/passport');

// Auth routes (register/login/me + OTP/email flows)
const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const orderRoutes = require('./routes/orders');
const frontendProductRoutes = require('./routes/frontendProducts');
const cartRoutes = require('./routes/cart');
const healthRoutes = require('./routes/health');
const adminRoutes = require('./routes/admin');
const imagekitRoutes = require('./routes/imagekit');

const app = express();
const PORT = process.env.PORT || 4000;

// Middlewares
// Support single FRONTEND_URL and/or comma-separated FRONTEND_URLS
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const FRONTEND_URLS = (process.env.FRONTEND_URLS || '')
  .split(',')
  .map(u => u.trim())
  .filter(Boolean);

const defaultOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://localhost:5176',
  'http://localhost:5177',
  'https://doordripp.com',
  'https://www.doordripp.com',
];

const allowedOrigins = Array.from(new Set([...defaultOrigins, FRONTEND_URL, ...FRONTEND_URLS]));

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like curl, mobile apps)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    if (process.env.CORS_ALLOW_ALL === 'true') return callback(null, true);
    return callback(new Error('CORS not allowed for origin: ' + origin), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400, // 24 hours
};

// Preflight request handler (MUST be before routes)
app.options('*', cors(corsOptions));

// Apply CORS to all routes
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
app.use('/api/admin', adminRoutes);
app.use('/api', imagekitRoutes);

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

function startServer(port, attempts = 0) {
  const maxAttempts = 5;
  const server = app.listen(port);

  server.on('listening', () => {
    console.log(`Doordripp Node backend listening on port ${port}`);
  });

  server.on('error', err => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use.`);
      if (attempts < maxAttempts) {
        const nextPort = Number(port) + 1;
        console.warn(`Trying next port ${nextPort} (attempt ${attempts + 1}/${maxAttempts})`);
        // Give the OS a short moment before retrying
        setTimeout(() => startServer(nextPort, attempts + 1), 200);
        return;
      }
      console.error(`Failed to bind after ${maxAttempts} attempts. Exiting.`);
      process.exit(1);
    }
    console.error('Server error:', err);
    process.exit(1);
  });
}

startServer(PORT);
