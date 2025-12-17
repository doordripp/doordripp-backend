const express = require('express')
const router = express.Router()
const { NEW_ARRIVALS, TOP_SELLING, ALL_PRODUCTS, CATEGORIES } = require('../data/frontendProducts')

router.get('/new-arrivals', (req, res) => res.json(NEW_ARRIVALS))
router.get('/top-selling', (req, res) => res.json(TOP_SELLING))
router.get('/all', (req, res) => res.json(ALL_PRODUCTS))
router.get('/categories', (req, res) => res.json(CATEGORIES))

module.exports = router
