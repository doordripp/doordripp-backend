const Product = require('../models/Product')
const { attachSaleInfoToProducts } = require('../utils/promotionHelpers')
const { buildProductInventoryPayload } = require('../utils/productInventory')
const { getSectionProductsWithPadding, getProductType } = require('../utils/shuffleUtils')
const logger = require('../utils/logger')

let precomputedHomePayload = null
let precomputedTime = 0
let isComputing = false

const SIX_HOURS_MS = 6 * 60 * 60 * 1000

const cardFields = '_id name slug price originalPrice discount stock category subcategory images colors sizes sizeInventory rating isNewArrival isBestSeller isFeatured details status createdAt'

function formatProduct(p) {
  const inventory = buildProductInventoryPayload(p)
  return {
    id: p._id,
    _id: p._id,
    name: p.name,
    slug: p.slug,
    price: p.price,
    originalPrice: p.originalPrice,
    discount: p.discount,
    stock: inventory.stock,
    category: p.category,
    subcategory: p.subcategory,
    images: p.images || [],
    image: p.images && p.images.length > 0 ? p.images[0] : null,
    colors: p.colors || [],
    sizes: inventory.sizes,
    sizeInventory: inventory.sizeInventory,
    availableSizes: inventory.availableSizes,
    defaultSize: inventory.defaultSize,
    inStock: inventory.inStock,
    rating: p.rating || { rating: 4.5, reviews: 0 },
    isNewArrival: p.isNewArrival || false,
    isBestSeller: p.isBestSeller || false,
    isFeatured: p.isFeatured || false,
    details: p.details || {},
    saleInfo: p.saleInfo || null
  }
}

async function refreshHomeProductsPrecomputation() {
  if (isComputing) return precomputedHomePayload
  isComputing = true

  try {
    const { getVisibilityFilter } = require('../utils/visibility')
    const baseFilter = getVisibilityFilter()

    // Fetch ALL active products across the entire database
    const allProducts = await Product.find(baseFilter)
      .sort({ createdAt: -1 })
      .select(cardFields)
      .lean()

    if (!allProducts || allProducts.length === 0) {
      isComputing = false
      return null
    }

    // 1. New Arrivals: Sample across entire DB list sorted by createdAt: -1 (max 1 perfume, max 2 per type)
    const finalNewArrivals = getSectionProductsWithPadding(allProducts, allProducts, 8, 'new-arrivals', { maxPerfumes: 1, maxPerType: 2 })

    // 2. Best Sellers: Filter best sellers or highly rated, sample across full pool (max 1 perfume, max 2 per type)
    const bestSellersPool = allProducts.filter(p => p.isBestSeller || (p.rating && p.rating.rating >= 4.0))
    const finalBestSellers = getSectionProductsWithPadding(bestSellersPool, allProducts, 8, 'top-selling', { maxPerfumes: 1, maxPerType: 2 })

    // 3. Featured / Popular: Filter featured items, sample across full pool (max 1 perfume, max 2 per type)
    const featuredPool = allProducts.filter(p => p.isFeatured)
    const finalFeatured = getSectionProductsWithPadding(featuredPool, allProducts, 8, 'popular-products', { maxPerfumes: 1, maxPerType: 2 })

    // 4. Accessories: Filter category accessories excluding perfumes (max 0 perfumes, max 2 per type)
    const nonPerfumeAll = allProducts.filter(p => getProductType(p) !== 'Perfumes')
    const accessoriesPool = allProducts.filter(p => {
      const cat = (p.category || '').toLowerCase().trim()
      return cat === 'accessories' && getProductType(p) !== 'Perfumes'
    })
    const finalAccessories = getSectionProductsWithPadding(accessoriesPool, nonPerfumeAll, 8, 'accessories', { maxPerfumes: 0, maxPerType: 2 })

    // Enrich all selected 32 products with sales info in 1 single pass
    const allSelected = [...finalNewArrivals, ...finalBestSellers, ...finalFeatured, ...finalAccessories]
    const enrichedAll = await attachSaleInfoToProducts(allSelected)
    const enrichedMap = new Map(enrichedAll.map(p => [p._id.toString(), formatProduct(p)]))

    const payload = {
      success: true,
      precomputedAt: new Date().toISOString(),
      data: {
        newArrivals: finalNewArrivals.map(p => enrichedMap.get(p._id.toString())),
        bestSellers: finalBestSellers.map(p => enrichedMap.get(p._id.toString())),
        featured: finalFeatured.map(p => enrichedMap.get(p._id.toString())),
        accessories: finalAccessories.map(p => enrichedMap.get(p._id.toString())),
      }
    }

    precomputedHomePayload = payload
    precomputedTime = Date.now()
    if (logger && logger.info) {
      logger.info('Precomputed home screen 6-hour products payload updated successfully')
    }
  } catch (err) {
    if (logger && logger.error) {
      logger.error('Failed to precompute home products payload:', err)
    }
  } finally {
    isComputing = false
  }

  return precomputedHomePayload
}

function getPrecomputedHomePayload() {
  return precomputedHomePayload
}

function initHomePrecomputation() {
  // Run initial precomputation asynchronously on boot
  setTimeout(() => {
    refreshHomeProductsPrecomputation().catch(err => console.error('Boot precomputation error:', err))
  }, 1000)

  // Schedule recurring 6-hour refresh
  setInterval(() => {
    refreshHomeProductsPrecomputation().catch(err => console.error('6-hour cron precomputation error:', err))
  }, SIX_HOURS_MS)
}

module.exports = {
  getPrecomputedHomePayload,
  refreshHomeProductsPrecomputation,
  initHomePrecomputation
}
