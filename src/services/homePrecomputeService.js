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

/**
 * Automatically ensures every collection (New Arrivals, Best Sellers, Featured)
 * has at least 8 products in the database so that DB, Admin Panel, Home UI, and
 * dedicated collection pages are 100% in sync at all times.
 */
async function ensureMinimumCollectionProducts() {
  try {
    const { getVisibilityFilter } = require('../utils/visibility')
    const baseFilter = getVisibilityFilter()

    // 1. Check New Arrivals count
    const newArrivalCount = await Product.countDocuments({ ...baseFilter, isNewArrival: true })
    if (newArrivalCount < 8) {
      const needed = 8 - newArrivalCount
      const candidates = await Product.find({ ...baseFilter, isNewArrival: { $ne: true } })
        .select('_id')
        .limit(100)
        .lean()
      if (candidates.length > 0) {
        const shuffled = candidates.sort(() => 0.5 - Math.random()).slice(0, needed)
        const idsToUpdate = shuffled.map(p => p._id)
        if (idsToUpdate.length > 0) {
          await Product.updateMany({ _id: { $in: idsToUpdate } }, { $set: { isNewArrival: true } })
          if (logger && logger.info) {
            logger.info(`Auto-synced ${idsToUpdate.length} products to isNewArrival in MongoDB`)
          }
        }
      }
    }

    // 2. Check Best Sellers count
    const bestSellerCount = await Product.countDocuments({ ...baseFilter, isBestSeller: true })
    if (bestSellerCount < 8) {
      const needed = 8 - bestSellerCount
      const candidates = await Product.find({ ...baseFilter, isBestSeller: { $ne: true } })
        .select('_id')
        .limit(100)
        .lean()
      if (candidates.length > 0) {
        const shuffled = candidates.sort(() => 0.5 - Math.random()).slice(0, needed)
        const idsToUpdate = shuffled.map(p => p._id)
        if (idsToUpdate.length > 0) {
          await Product.updateMany({ _id: { $in: idsToUpdate } }, { $set: { isBestSeller: true } })
          if (logger && logger.info) {
            logger.info(`Auto-synced ${idsToUpdate.length} products to isBestSeller in MongoDB`)
          }
        }
      }
    }

    // 3. Check Featured count
    const featuredCount = await Product.countDocuments({ ...baseFilter, isFeatured: true })
    if (featuredCount < 8) {
      const needed = 8 - featuredCount
      const candidates = await Product.find({ ...baseFilter, isFeatured: { $ne: true } })
        .select('_id')
        .limit(100)
        .lean()
      if (candidates.length > 0) {
        const shuffled = candidates.sort(() => 0.5 - Math.random()).slice(0, needed)
        const idsToUpdate = shuffled.map(p => p._id)
        if (idsToUpdate.length > 0) {
          await Product.updateMany({ _id: { $in: idsToUpdate } }, { $set: { isFeatured: true } })
          if (logger && logger.info) {
            logger.info(`Auto-synced ${idsToUpdate.length} products to isFeatured in MongoDB`)
          }
        }
      }
    }
  } catch (err) {
    if (logger && logger.error) {
      logger.error('Error ensuring minimum collection products:', err)
    }
  }
}

async function refreshHomeProductsPrecomputation() {
  if (isComputing) return precomputedHomePayload
  isComputing = true

  try {
    // 0. Ensure minimum collection products in DB first
    await ensureMinimumCollectionProducts()

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

    // 1. New Arrivals: Filter isNewArrival: true (or fall back to all sorted by createdAt)
    const newArrivalsPool = allProducts.filter(p => p.isNewArrival)
    const finalNewArrivals = getSectionProductsWithPadding(
      newArrivalsPool.length > 0 ? newArrivalsPool : allProducts, 
      allProducts, 
      8, 
      'new-arrivals', 
      { maxPerfumes: 1, maxPerType: 2 }
    )

    // 2. Best Sellers: Filter isBestSeller or rating >= 4.0
    const bestSellersPool = allProducts.filter(p => p.isBestSeller || (p.rating && p.rating.rating >= 4.0))
    const finalBestSellers = getSectionProductsWithPadding(
      bestSellersPool.length > 0 ? bestSellersPool : allProducts, 
      allProducts, 
      8, 
      'top-selling', 
      { maxPerfumes: 1, maxPerType: 2 }
    )

    // 3. Featured / Popular: Filter isFeatured items
    const featuredPool = allProducts.filter(p => p.isFeatured)
    const finalFeatured = getSectionProductsWithPadding(
      featuredPool.length > 0 ? featuredPool : allProducts, 
      allProducts, 
      8, 
      'popular-products', 
      { maxPerfumes: 1, maxPerType: 2 }
    )

    // 4. Accessories: Filter category accessories excluding perfumes
    const nonPerfumeAll = allProducts.filter(p => getProductType(p) !== 'Perfumes')
    const accessoriesPool = allProducts.filter(p => {
      const cat = (p.category || '').toLowerCase().trim()
      return cat === 'accessories' && getProductType(p) !== 'Perfumes'
    })
    const finalAccessories = getSectionProductsWithPadding(
      accessoriesPool.length > 0 ? accessoriesPool : nonPerfumeAll, 
      nonPerfumeAll, 
      8, 
      'accessories', 
      { maxPerfumes: 0, maxPerType: 2 }
    )

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

function getSectionTop8Ids(sectionName) {
  if (!precomputedHomePayload?.data) return []
  let items = []
  const norm = String(sectionName || '').toLowerCase().replace(/[-_]/g, '')
  if (norm === 'newarrivals' || norm === 'newarrival') {
    items = precomputedHomePayload.data.newArrivals || []
  } else if (norm === 'bestsellers' || norm === 'bestseller' || norm === 'topselling') {
    items = precomputedHomePayload.data.bestSellers || []
  } else if (norm === 'featured' || norm === 'popularproducts') {
    items = precomputedHomePayload.data.featured || []
  } else if (norm === 'accessories') {
    items = precomputedHomePayload.data.accessories || []
  }
  return items.map(p => String(p.id || p._id)).filter(Boolean)
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
  getSectionTop8Ids,
  ensureMinimumCollectionProducts,
  refreshHomeProductsPrecomputation,
  initHomePrecomputation
}
