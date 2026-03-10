const path = require('path');
const dotenv = require('dotenv');

// Load environment variables based on NODE_ENV
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development';
dotenv.config({ path: path.join(__dirname, '..', envFile) });

// Validate required environment variables before anything else
const validateEnv = require('./config/validateEnv');
validateEnv();

const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const cookieParser = require('cookie-parser');
// Passport (OAuth strategies)
const passport = require('./config/passport');

// Auth routes (register/login/me + OTP/email flows)
const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const reviewRoutes = require('./routes/reviews');
const orderRoutes = require('./routes/orders');
const frontendProductRoutes = require('./routes/frontendProducts');
const cartRoutes = require('./routes/cart');
const wishlistRoutes = require('./routes/wishlist');
const healthRoutes = require('./routes/health');
const adminRoutes = require('./routes/admin');
const imagekitRoutes = require('./routes/imagekit');
const webhookRoutes = require('./routes/webhooks');
const addressRoutes = require('./routes/address');
const invoiceRoutes = require('./routes/invoice');
const supportRoutes = require('./routes/support');
const trialRoomRoutes = require('./routes/trialRoom');
const contentRoutes = require('./routes/content');
const deliveryRoutes = require('./routes/delivery');
const deliveryPartnerRoutes = require('./routes/deliveryPartner');
const voucherRoutes = require('./routes/voucher.routes');
// Socket.io setup
const { setupSocketIO } = require('./sockets')
const logger = require('./utils/logger')
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
    // Block requests with no origin in production (prevents server-side request forgery)
    if (!origin) {
      if (process.env.NODE_ENV === 'production') {
        return callback(new Error('CORS not allowed: missing origin'), false);
      }
      // Allow no-origin requests only in development (e.g., curl, Postman)
      return callback(null, true);
    }

    // Allow all localhost origins in development only
    if (origin.startsWith('http://localhost:') && process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) return callback(null, true);

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

// Permissions-Policy header fix for Razorpay
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'otp-credentials=*, local-network-access=*');
  next();
});

app.use(express.json());
app.use(cookieParser());
app.use(morgan('dev'));
// Initialize passport (strategies are configured in `src/config/passport.js`)
app.use(passport.initialize());

// Connect to MongoDB (if configured)
try {
  const connectDB = require('./config/db');
  connectDB().catch(err => logger.error('DB connect error', err));
} catch (e) {
  logger.warn('No DB connector found:', e.message || e);
}

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/frontend/products', frontendProductRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/wishlist', wishlistRoutes);
app.use('/api/trial-room', trialRoomRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', imagekitRoutes);
app.use('/api', addressRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/delivery', deliveryRoutes);
app.use('/api/delivery-partner', deliveryPartnerRoutes);
app.use('/api/voucher', voucherRoutes);
app.use('/webhooks', webhookRoutes);

// Health
app.get('/', (req, res) => res.json({ ok: true, version: '0.1.0' }));

// Serve React build if present
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
  logger.error(err.message || 'Server error', err);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

function startServer(port, attempts = 0) {
  const maxAttempts = 5;
  const server = app.listen(port);

  // Initialize Socket.io with CORS options
  const io = setupSocketIO(server, corsOptions)

  // Attach io to app so controllers can emit events
  app.set('io', io)

  server.on('listening', () => {
    logger.info(`Doordripp Node backend listening on port ${port}`);
    logger.info('Socket.io tracking enabled');
  });

  server.on('error', err => {
    if (err && err.code === 'EADDRINUSE') {
      logger.error(`Port ${port} is already in use.`);
      if (attempts < maxAttempts) {
        const nextPort = Number(port) + 1;
        logger.warn(`Trying next port ${nextPort} (attempt ${attempts + 1}/${maxAttempts})`);
        // Give the OS a short moment before retrying
        setTimeout(() => startServer(nextPort, attempts + 1), 200);
        return;
      }
      logger.error(`Failed to bind after ${maxAttempts} attempts. Exiting.`);
      process.exit(1);
    }
    logger.error('Server error:', err);
    process.exit(1);
  });
}

startServer(PORT);
