const express = require('express')
const mongoose = require('mongoose')
const router = express.Router()

router.get('/', (req, res) => {
  const state = mongoose.connection.readyState // 0 = disconnected, 1 = connected
  res.json({ ok: true, db: state === 1 ? 'connected' : 'disconnected', readyState: state })
})

module.exports = router
