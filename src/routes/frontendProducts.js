const express = require('express')
const router = express.Router()
const Product = require('../models/Product')
const { getPrecomputedHomePayload, refreshHomeProductsPrecomputation } = require('../services/homePrecomputeService')

router.get('/new-arrivals', async (req, res) => {
  try {
    const payload = getPrecomputedHomePayload() || await refreshHomeProductsPrecomputation()
    res.json(payload?.data?.newArrivals || [])
  } catch (error) {
    res.json([])
  }
})

router.get('/top-selling', async (req, res) => {
  try {
    const payload = getPrecomputedHomePayload() || await refreshHomeProductsPrecomputation()
    res.json(payload?.data?.bestSellers || [])
  } catch (error) {
    res.json([])
  }
})

router.get('/featured', async (req, res) => {
  try {
    const payload = getPrecomputedHomePayload() || await refreshHomeProductsPrecomputation()
    res.json(payload?.data?.featured || [])
  } catch (error) {
    res.json([])
  }
})

router.get('/all', async (req, res) => {
  try {
    const products = await Product.find({ status: 'Active' }).limit(100).lean()
    res.json(products)
  } catch (error) {
    res.json([])
  }
})

// Fetch categories from database (dynamic)
router.get('/categories', async (req, res) => {
  try {
    const categories = await Product.distinct('category')
    const sortedCategories = categories.filter(Boolean).sort()
    res.json(sortedCategories)
  } catch (error) {
    res.json(['T-Shirts', 'Jeans', 'Shirts', 'Shorts', 'Accessories', 'Footwear'])
  }
})

module.exports = router
