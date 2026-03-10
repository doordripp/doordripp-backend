/**
 * Socket.io Server Setup
 * Initialize Socket.io with CORS and authentication
 * Handles real-time order status updates
 */

const socketIO = require('socket.io')
const logger = require('../utils/logger')

const JWT_SECRET = process.env.JWT_SECRET

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
      if (!JWT_SECRET) {
        socket.data.authenticated = false
        return next()
      }
      const decoded = jwt.verify(token, JWT_SECRET)
      socket.data.authenticated = true
      socket.data.userId = decoded.id || decoded.userId
      socket.data.roles = decoded.roles || ['customer']
      next()
    } catch (error) {
      logger.security('[Socket] Authentication failed', { message: error.message })
      socket.data.authenticated = false
      next() // Allow connection but mark as unauthenticated
    }
  })

  // Global connection handler
  io.on('connection', (socket) => {
    logger.socket(`New connection: ${socket.id}`)

    // Join order room for real-time updates
    socket.on('joinOrderRoom', (orderId) => {
      if (orderId) {
        socket.join(`order_${orderId}`)
        logger.socket(`Client ${socket.id} joined order room: order_${orderId}`)
      }
    })

    // Leave order room
    socket.on('leaveOrderRoom', (orderId) => {
      if (orderId) {
        socket.leave(`order_${orderId}`)
        logger.socket(`Client ${socket.id} left order room: order_${orderId}`)
      }
    })

    // Ping/Pong for keep-alive
    socket.on('ping', () => {
      socket.emit('pong')
    })

    // Handle disconnect
    socket.on('disconnect', () => {
      logger.socket(`Client disconnected: ${socket.id}`)
    })

    // Generic error handler
    socket.on('error', (error) => {
      logger.error(`[Socket.io] Socket error: ${socket.id}`, error)
    })
  })

  return io
}

module.exports = { setupSocketIO }
