const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');

// Capture any NODE_ENV set explicitly via the shell/process manager BEFORE
// loading dotenv files so that the base .env cannot override it.
const explicitNodeEnv = process.env.NODE_ENV;

// Load base .env (shared defaults / secrets)
const envDir = path.join(__dirname, '..');
dotenv.config({ path: path.join(envDir, '.env') });

// If NODE_ENV was set explicitly before dotenv loaded, honour it.
// Otherwise fall back to whatever .env set (or default to 'development').
if (explicitNodeEnv) {
  process.env.NODE_ENV = explicitNodeEnv;
}

// Determine environment-specific file
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development';
const baseEnvPath = path.join(envDir, envFile);
const envLocalPath = path.join(envDir, `${envFile}.local`);
const rootLocalPath = path.join(envDir, '.env.local');

// Load environment-specific file (override base .env values)
dotenv.config({ path: baseEnvPath, override: true });
if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath, override: true });
}
if (fs.existsSync(rootLocalPath)) {
  dotenv.config({ path: rootLocalPath, override: true });
}

// Validate required environment variables before anything else
const validateEnv = require('./config/validateEnv');
validateEnv();

// Initialize ImageKit immediately after env validation
const imagekitConfig = require('./config/imagekit');
imagekitConfig.initializeImageKit();

const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
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
const managerRoutes = require('./routes/manager');
const marketingRoutes = require('./routes/marketing');
// Socket.io setup
const { setupSocketIO } = require('./sockets')
const logger = require('./utils/logger')
const app = express();
const PORT = process.env.PORT || 4000;

function captureRawBody(req, res, buf) {
  if (buf && buf.length > 0) {
    req.rawBody = buf.toString('utf8');
  }
}

// Middlewares
// Support a single FRONTEND_URL plus built-in defaults
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

const normalizeOrigin = (url) => {
  if (!url || typeof url !== 'string') return '';
  return url.trim().replace(/\/$/, '');
};

const defaultOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://localhost:5176',
  'http://localhost:5177',
  'https://doordripp.com',
  'https://www.doordripp.com'
];

const allowedOrigins = Array.from(
  new Set([...defaultOrigins, FRONTEND_URL].map(normalizeOrigin).filter(Boolean))
);

const corsOptions = {
  origin: function (origin, callback) {
    // In production allow no-origin requests from same-server health checks / Nginx
    if (!origin) {
      return callback(null, true);
    }

    // Allow all localhost origins in development only
    if (origin.startsWith('http://localhost:') && process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }

    const normalizedOrigin = normalizeOrigin(origin);
    if (allowedOrigins.includes(normalizedOrigin)) return callback(null, true);

    const err = new Error('CORS not allowed for origin: ' + origin);
    err.status = 403;
    return callback(err, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400, // 24 hours
};

app.use('/webhooks', express.json({ verify: captureRawBody }), webhookRoutes);

// Preflight request handler (MUST be before routes)
app.options('*', cors(corsOptions));

// Apply CORS to all routes
app.use(cors(corsOptions));

// Configure Helmet for security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'", 
        "'unsafe-inline'", 
        "'unsafe-eval'", 
        "https://checkout.razorpay.com", 
        "https://maps.googleapis.com", 
        "https://cdn.onesignal.com"
      ],
      styleSrc: [
        "'self'", 
        "'unsafe-inline'", 
        "https://fonts.googleapis.com"
      ],
      imgSrc: [
        "'self'", 
        "data:", 
        "blob:", 
        "https://ik.imagekit.io", 
        "https://lh3.googleusercontent.com", 
        "https://*.tile.openstreetmap.org", 
        "https://via.placeholder.com", 
        "https://placeholder.com"
      ],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      connectSrc: [
        "'self'", 
        "https://checkout.razorpay.com", 
        "https://router.project-osrm.org", 
        "https://maps.googleapis.com", 
        "https://cdn.onesignal.com", 
        "https://onesignal.com"
      ],
      frameSrc: ["'self'", "https://checkout.razorpay.com"],
      workerSrc: ["'self'", "blob:"],
    },
  },
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginOpenerPolicy: { policy: "unsafe-none" },
}));

// Permissions-Policy header fix for Razorpay
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'payment=*, camera=*, microphone=*');
  next();
});

app.use(express.json());
app.use(mongoSanitize());
app.use(cookieParser());
app.use(morgan('dev'));

const rateLimit = require('express-rate-limit');
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Limit each IP to 1000 requests per windowMs to prevent brute force
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this IP, please try again after 15 minutes' }
});
app.use('/api', apiLimiter);

// Initialize passport (strategies are configured in `src/config/passport.js`)
app.use(passport.initialize());

// Routes
app.use('/api/auth', authRoutes);

// OAuth compatibility aliases (Spring-style paths) mapped to existing auth routes.
app.get('/oauth2/authorization/google', (req, res) => {
  const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  return res.redirect(`/api/auth/google${query}`);
});

app.get('/oauth2/authorization/google-auth-dev', (req, res) => {
  const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  return res.redirect(`/api/auth/google-auth-dev${query}`);
});

app.get('/login/oauth2/code/google', (req, res) => {
  const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  return res.redirect(`/api/auth/google/callback${query}`);
});

app.get('/login/oauth2/code/google-auth-dev', (req, res) => {
  const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  return res.redirect(`/api/auth/google-auth-dev/callback${query}`);
});

app.use('/api/products', productRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/frontend/products', frontendProductRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/wishlist', wishlistRoutes);
app.use('/api/trial-room', trialRoomRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/manager', managerRoutes);
app.use('/api', imagekitRoutes);
app.use('/api', addressRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/marketing', marketingRoutes);
app.use('/api/delivery', deliveryRoutes);
app.use('/api/delivery-partner', deliveryPartnerRoutes);
app.use('/api/voucher', voucherRoutes);
// Health
app.get('/', (req, res) => res.json({ ok: true, version: '0.1.0' }));

// Serve React build if present
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

async function bootstrap() {
  try {
    await require('./config/db')();
    startServer(PORT);
  } catch (err) {
    logger.error('Failed to initialize backend before start:', err);
    process.exit(1);
  }
}

bootstrap();
// test commit for CI/CD check
