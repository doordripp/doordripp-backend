/**
 * Socket.io Server Setup
 * Initialize Socket.io with CORS and authentication
 */

const socketIO = require('socket.io')
const { initializeTracking } = require('./tracking')

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'

/**
 * Setup Socket.io server
 * @param {http.Server} httpServer - Express server
 * @param {object} corsOptions - CORS options
 * @returns {object} io instance
 */
function setupSocketIO(httpServer, corsOptions) {
  const io = socketIO(httpServer, {
    cors: {
      origin: corsOptions.origin,
      methods: ['GET', 'POST'],
      credentials: true
    },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 5
  })

  // Middleware: Authenticate socket connection
  io.use((socket, next) => {
    const token = socket.handshake.auth.token

    if (!token) {
      // Allow unauthenticated connections, but mark them
      socket.data.authenticated = false
      return next()
    }

    try {
      const jwt = require('jsonwebtoken')
      const decoded = jwt.verify(token, JWT_SECRET)
      socket.data.authenticated = true
      socket.data.userId = decoded.id || decoded.userId
      socket.data.userRole = decoded.role || 'customer'
      next()
    } catch (error) {
      console.error('[Socket] Authentication failed:', error.message)
      socket.data.authenticated = false
      next() // Allow connection but mark as unauthenticated
    }
  })

  // Initialize tracking handlers
  initializeTracking(io)

  // Global connection handler
  io.on('connection', (socket) => {
    console.log(`[Socket.io] New connection: ${socket.id}`)

    // Ping/Pong for keep-alive
    socket.on('ping', () => {
      socket.emit('pong')
    })

    // Generic error handler
    socket.on('error', (error) => {
      console.error(`[Socket.io] Socket error: ${socket.id} -`, error)
    })
  })

  return io
}

module.exports = { setupSocketIO }
