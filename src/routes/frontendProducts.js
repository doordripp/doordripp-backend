const express = require('express')
const router = express.Router()
const { NEW_ARRIVALS, TOP_SELLING, ALL_PRODUCTS, CATEGORIES } = require('../data/frontendProducts')
const Product = require('../models/Product')

router.get('/new-arrivals', (req, res) => res.json(NEW_ARRIVALS))
router.get('/top-selling', (req, res) => res.json(TOP_SELLING))
router.get('/all', (req, res) => res.json(ALL_PRODUCTS))

// Fetch categories from database (dynamic) or fallback to static data
router.get('/categories', async (req, res) => {
  try {
    const categories = await Product.distinct('category')
    const sortedCategories = categories.filter(Boolean).sort()
    res.json(sortedCategories)
  } catch (error) {
    console.error('Error fetching categories:', error)
    res.json(CATEGORIES)
  }
})

module.exports = router
