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

// Express application (routes, middleware) lives in ./app so tests can load it
// without opening a port or a database connection.
const { app, corsOptions } = require('./app');
const { setupSocketIO } = require('./sockets');
const logger = require('./utils/logger');
const PORT = process.env.PORT || 4000;

const { disconnectDB } = require('./config/db');

let activeServer = null;

function handleGracefulShutdown(signal) {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);

  if (activeServer) {
    activeServer.close(async () => {
      logger.info('HTTP server closed.');
      await disconnectDB();
      logger.info('Graceful shutdown completed successfully.');
      process.exit(0);
    });

    // Force exit if connections don't close within 10 seconds
    setTimeout(() => {
      logger.error('Could not close connections in time, forcing shut down.');
      process.exit(1);
    }, 10000);
  } else {
    process.exit(0);
  }
}

process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));
process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise);
  logger.error('Reason:', reason);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception thrown:', err);
  handleGracefulShutdown('uncaughtException');
});

function startServer(port, attempts = 0) {
  const maxAttempts = 5;
  const server = app.listen(port);
  activeServer = server;

  // Initialize Socket.io with CORS options
  const io = setupSocketIO(server, corsOptions);

  // Attach io to app so controllers can emit events
  app.set('io', io);

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
    const connectDB = require('./config/db');
    await connectDB();
    const { initHomePrecomputation } = require('./services/homePrecomputeService');
    initHomePrecomputation();

    // Unpaid online orders hold stock; release the ones that were abandoned.
    const { expireStalePendingOrders } = require('./services/orderLifecycle.service');
    const sweep = () => expireStalePendingOrders()
      .then(count => { if (count) logger.info(`Released stock held by ${count} abandoned order(s)`); })
      .catch(err => logger.error('Stale order sweep failed', err));
    setInterval(sweep, 5 * 60 * 1000).unref();
    sweep();

    startServer(PORT);
  } catch (err) {
    logger.error('Failed to initialize backend before start:', err);
    process.exit(1);
  }
}

bootstrap();
