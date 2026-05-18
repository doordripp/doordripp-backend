const express = require('express')
const mongoose = require('mongoose')
const { isImageKitReady } = require('../utils/imagekit-upload')
const router = express.Router()

router.get('/', (req, res) => {
  const state = mongoose.connection.readyState // 0 = disconnected, 1 = connected
  res.json({ ok: true, db: state === 1 ? 'connected' : 'disconnected', readyState: state })
})

// Safe operational check: returns only boolean status, never credentials.
router.get('/imagekit', (req, res) => {
  res.json({ ok: true, imagekitConfigured: isImageKitReady() })
})

module.exports = router
