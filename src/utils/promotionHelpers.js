const SaleCampaign = require('../models/SaleCampaign')

const toDate = (value) => {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

const isWithinTimeWindow = (startTime, endTime, now = new Date()) => {
  const start = toDate(startTime)
  const end = toDate(endTime)
  if (!start || !end) return false
  return start.getTime() <= now.getTime() && end.getTime() >= now.getTime()
}

const buildSaleSlug = (name = '') =>
  String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')

const saleMatchesProduct = (sale, product) => {
  if (!sale || !product) return false

  if (sale.applyTo === 'all') return true

  if (sale.applyTo === 'category') {
    if (!sale.category || !product.category) return false
    return String(sale.category).trim().toLowerCase() === String(product.category).trim().toLowerCase()
  }

  if (sale.applyTo === 'products') {
    const productId = String(product._id || product.id || '')
    return Array.isArray(sale.productIds) && sale.productIds.some((id) => String(id) === productId)
  }

  return false
}

const summarizeSale = (sale) => ({
  _id: sale._id,
  id: sale._id,
  name: sale.name,
  slug: sale.slug,
  description: sale.description,
  startTime: sale.startTime,
  endTime: sale.endTime,
  isActive: sale.isActive,
  applyTo: sale.applyTo,
  category: sale.category,
  productIds: sale.productIds || [],
  priority: sale.priority || 0,
  allowOverlap: Boolean(sale.allowOverlap),
  effectiveStatus: sale.isActive && isWithinTimeWindow(sale.startTime, sale.endTime),
  timeActive: isWithinTimeWindow(sale.startTime, sale.endTime)
})

async function getEffectiveSales(filter = {}) {
  const sales = await SaleCampaign.find(filter).sort({ priority: -1, startTime: 1, createdAt: -1 }).lean()
  return sales.map(summarizeSale).filter((sale) => sale.effectiveStatus)
}

async function attachSaleInfoToProducts(products = []) {
  if (!Array.isArray(products) || products.length === 0) return products

  const activeSales = await getEffectiveSales({ isActive: true })
  return products.map((product) => {
    const matchingSales = activeSales.filter((sale) => saleMatchesProduct(sale, product))
    const primarySale = matchingSales[0] || null

    return {
      ...product,
      saleInfo: {
        hasSale: matchingSales.length > 0,
        saleCount: matchingSales.length,
        badgeText: primarySale ? (primarySale.name || 'On Sale') : '',
        salePage: primarySale ? `/sales/${primarySale.slug || primarySale.id}` : '',
        primarySale,
        activeSales: matchingSales
      }
    }
  })
}

async function getSaleProducts(sale) {
  if (!sale) return []
  const Product = require('../models/Product')

  if (sale.applyTo === 'all') {
    return Product.find({}).sort({ createdAt: -1 }).lean()
  }

  if (sale.applyTo === 'category') {
    return Product.find({ category: new RegExp(`^${sale.category}$`, 'i') }).sort({ createdAt: -1 }).lean()
  }

  if (sale.applyTo === 'products' && Array.isArray(sale.productIds) && sale.productIds.length > 0) {
    return Product.find({ _id: { $in: sale.productIds } }).sort({ createdAt: -1 }).lean()
  }

  return []
}

function hasSaleOverlapConflict(existingSale, incomingSale) {
  if (!existingSale || !incomingSale) return false

  const existingWindowStart = toDate(existingSale.startTime)
  const existingWindowEnd = toDate(existingSale.endTime)
  const incomingWindowStart = toDate(incomingSale.startTime)
  const incomingWindowEnd = toDate(incomingSale.endTime)

  if (!existingWindowStart || !existingWindowEnd || !incomingWindowStart || !incomingWindowEnd) {
    return false
  }

  const overlaps = existingWindowStart <= incomingWindowEnd && incomingWindowStart <= existingWindowEnd
  if (!overlaps) return false

  if (existingSale.applyTo === 'all' || incomingSale.applyTo === 'all') {
    return true
  }

  if (existingSale.applyTo === 'category' && incomingSale.applyTo === 'category') {
    return String(existingSale.category || '').trim().toLowerCase() === String(incomingSale.category || '').trim().toLowerCase()
  }

  if (existingSale.applyTo === 'products' && incomingSale.applyTo === 'products') {
    const existingIds = new Set((existingSale.productIds || []).map((id) => String(id)))
    return (incomingSale.productIds || []).some((id) => existingIds.has(String(id)))
  }

  if (existingSale.applyTo === 'category' && incomingSale.applyTo === 'products') {
    return (incomingSale.category || '').trim().toLowerCase() === String(existingSale.category || '').trim().toLowerCase()
  }

  if (existingSale.applyTo === 'products' && incomingSale.applyTo === 'category') {
    return (existingSale.category || '').trim().toLowerCase() === String(incomingSale.category || '').trim().toLowerCase()
  }

  return false
}

module.exports = {
  attachSaleInfoToProducts,
  buildSaleSlug,
  getEffectiveSales,
  getSaleProducts,
  hasSaleOverlapConflict,
  isWithinTimeWindow,
  saleMatchesProduct,
  summarizeSale,
  toDate
}
