/**
 * Socket.io Real-time Order Tracking
 * Handles rider location updates and customer tracking
 */

const jwt = require('jsonwebtoken')
const Order = require('../models/Order')
const User = require('../models/User')
const { shouldThrottleUpdate, hasSignificantMovement } = require('../utils/tracking')

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'

// Track rate limiting per rider
const riderUpdateTracking = new Map()

/**
 * Initialize Socket.io tracking handlers
 * @param {object} io - Socket.io instance
 */
function initializeTracking(io) {
  io.on('connection', (socket) => {
    console.log(`[Socket] Client connected: ${socket.id}`)

    // Handle rider joining tracking
    socket.on('riderJoinTracking', async (data) => {
      try {
        const { orderId, token } = data

        // Validate JWT
        const decoded = jwt.verify(token, JWT_SECRET)
        const userId = decoded.id || decoded.userId

        // Verify this is the assigned rider for this order
        const order = await Order.findById(orderId)
        if (!order) {
          socket.emit('error', { message: 'Order not found' })
          return
        }

        if (!order.deliveryPartner?.riderId || order.deliveryPartner.riderId.toString() !== userId) {
          socket.emit('error', { message: 'Unauthorized - not assigned to this order' })
          return
        }

        // Join room for this order
        socket.join(orderId)
        socket.data.orderId = orderId
        socket.data.userId = userId
        socket.data.role = 'rider'

        console.log(`[Socket] Rider ${userId} joined order room ${orderId}`)

        // Initialize rate limiting tracker
        if (!riderUpdateTracking.has(orderId)) {
          riderUpdateTracking.set(orderId, {
            lastUpdate: null,
            lastLocation: null
          })
        }

        // Notify customer that rider is tracking
        io.to(orderId).emit('riderOnline', {
          riderId: userId,
          timestamp: new Date()
        })
      } catch (error) {
        console.error(`[Socket] Error in riderJoinTracking:`, error.message)
        socket.emit('error', { message: 'Authentication failed' })
      }
    })

    // Handle customer joining tracking
    socket.on('customerJoinTracking', async (data) => {
      try {
        const { orderId, token } = data

        // Validate JWT
        const decoded = jwt.verify(token, JWT_SECRET)
        const userId = decoded.id || decoded.userId

        // Verify customer owns this order
        const order = await Order.findById(orderId)
        if (!order) {
          socket.emit('error', { message: 'Order not found' })
          return
        }

        if (order.customer.toString() !== userId) {
          socket.emit('error', { message: 'Unauthorized - not your order' })
          return
        }

        // Join room for this order
        socket.join(orderId)
        socket.data.orderId = orderId
        socket.data.userId = userId
        socket.data.role = 'customer'

        console.log(`[Socket] Customer ${userId} joined order room ${orderId}`)

        // Send current rider location if available
        if (
          order.deliveryPartner?.location?.lat &&
          order.deliveryPartner?.location?.lng
        ) {
          socket.emit('currentRiderLocation', {
            lat: order.deliveryPartner.location.lat,
            lng: order.deliveryPartner.location.lng,
            timestamp: order.lastLocationUpdate
          })
        }

        // Notify in room that customer is watching
        io.to(orderId).emit('customerOnline', {
          customerId: userId,
          timestamp: new Date()
        })
      } catch (error) {
        console.error(`[Socket] Error in customerJoinTracking:`, error.message)
        socket.emit('error', { message: 'Authentication failed' })
      }
    })

    // Handle rider location update (CRITICAL - Rate Limited)
    socket.on('riderLocationUpdate', async (data) => {
      try {
        const orderId = socket.data.orderId
        const userId = socket.data.userId

        if (!orderId || !userId || socket.data.role !== 'rider') {
          socket.emit('error', { message: 'Not authenticated as rider' })
          return
        }

        const { lat, lng } = data

        // Validate coordinates
        if (
          typeof lat !== 'number' ||
          typeof lng !== 'number' ||
          lat < -90 ||
          lat > 90 ||
          lng < -180 ||
          lng > 180
        ) {
          socket.emit('error', { message: 'Invalid coordinates' })
          return
        }

        // Rate limiting (max 1 update per 5 seconds)
        const tracking = riderUpdateTracking.get(orderId)
        if (!shouldThrottleUpdate(tracking.lastUpdate, 5)) {
          return // Silently ignore if too frequent
        }

        // Check for significant movement (> 20 meters)
        const lastLoc = tracking.lastLocation
        if (lastLoc && !hasSignificantMovement(lastLoc, { lat, lng }, 20)) {
          return // Movement too small, ignore
        }

        // Update database
        const order = await Order.findById(orderId)
        if (!order) {
          socket.emit('error', { message: 'Order not found' })
          return
        }

        // Update delivery partner location
        order.deliveryPartner.location = { lat, lng }
        order.lastLocationUpdate = new Date()

        // Add to timeline if order status is OUT_FOR_DELIVERY
        if (order.orderStatus === 'OUT_FOR_DELIVERY') {
          order.timeline.push({
            status: 'OUT_FOR_DELIVERY',
            timestamp: new Date(),
            lat,
            lng
          })
        }

        await order.save()

        // Update tracking
        tracking.lastUpdate = new Date()
        tracking.lastLocation = { lat, lng }

        // Broadcast to order room (only this order's customers and rider)
        io.to(orderId).emit('locationUpdated', {
          lat,
          lng,
          timestamp: new Date(),
          riderId: userId,
          orderId
        })

        console.log(
          `[Socket] Location updated for order ${orderId}: (${lat}, ${lng})`
        )
      } catch (error) {
        console.error(`[Socket] Error in riderLocationUpdate:`, error.message)
        socket.emit('error', { message: 'Failed to update location' })
      }
    })

    // Handle order status update
    socket.on('updateOrderStatus', async (data) => {
      try {
        const { orderId, newStatus } = data
        const userId = socket.data.userId

        if (socket.data.role !== 'rider') {
          socket.emit('error', { message: 'Only riders can update status' })
          return
        }

        const validStatuses = ['CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED']
        if (!validStatuses.includes(newStatus)) {
          socket.emit('error', { message: 'Invalid status' })
          return
        }

        const order = await Order.findById(orderId)
        if (!order) {
          socket.emit('error', { message: 'Order not found' })
          return
        }

        if (order.deliveryPartner?.riderId?.toString() !== userId) {
          socket.emit('error', { message: 'Unauthorized' })
          return
        }

        // Update status
        order.orderStatus = newStatus
        order.timeline.push({
          status: newStatus,
          timestamp: new Date(),
          lat: order.deliveryPartner?.location?.lat,
          lng: order.deliveryPartner?.location?.lng
        })

        // Update legacy status field
        if (newStatus === 'DELIVERED') {
          order.status = 'delivered'
        } else if (newStatus === 'CANCELLED') {
          order.status = 'cancelled'
        }

        await order.save()

        // Broadcast to all in order room
        io.to(orderId).emit('statusUpdated', {
          status: newStatus,
          timestamp: new Date(),
          orderId
        })

        console.log(`[Socket] Order ${orderId} status updated to ${newStatus}`)
      } catch (error) {
        console.error(`[Socket] Error in updateOrderStatus:`, error.message)
        socket.emit('error', { message: 'Failed to update status' })
      }
    })

    // Handle disconnect
    socket.on('disconnect', () => {
      const orderId = socket.data.orderId
      const userId = socket.data.userId
      const role = socket.data.role

      console.log(
        `[Socket] ${role || 'Client'} ${userId} disconnected from order ${orderId}`
      )

      // Notify others in room that user left
      if (orderId) {
        io.to(orderId).emit(`${role}Offline`, {
          userId,
          timestamp: new Date()
        })

        // Clean up tracking data if no more riders in room
        const room = io.sockets.adapter.rooms.get(orderId)
        if (!room || room.size === 0) {
          riderUpdateTracking.delete(orderId)
        }
      }
    })

    // Handle errors
    socket.on('error', (error) => {
      console.error(`[Socket] Error for client ${socket.id}:`, error)
    })
  })
}

module.exports = { initializeTracking }
