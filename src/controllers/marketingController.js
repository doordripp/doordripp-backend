const SaleCampaign = require('../models/SaleCampaign')
const PopupBanner = require('../models/PopupBanner')
const Product = require('../models/Product')
const { buildSaleSlug, getEffectiveSales, getSaleProducts, hasSaleOverlapConflict, isWithinTimeWindow, summarizeSale, attachSaleInfoToProducts } = require('../utils/promotionHelpers')
const mongoose = require('mongoose')

const parseDateTime = (value) => {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

const toSlug = (sale) => sale.slug || buildSaleSlug(sale.name)

const findSaleByIdentifier = async (identifier) => {
  const query = [{ slug: identifier }]
  if (mongoose.isValidObjectId(identifier)) {
    query.unshift({ _id: identifier })
  }
  return SaleCampaign.findOne({ $or: query }).lean()
}

const validateSalePayload = (payload = {}) => {
  const errors = []
  if (!payload.name || !String(payload.name).trim()) errors.push('Sale name is required')
  if (!payload.startTime) errors.push('Start time is required')
  if (!payload.endTime) errors.push('End time is required')
  if (payload.startTime && payload.endTime) {
    const start = parseDateTime(payload.startTime)
    const end = parseDateTime(payload.endTime)
    if (!start || !end) errors.push('Valid start and end time are required')
    else if (start >= end) errors.push('End time must be after start time')
  }
  if (!['all', 'category', 'products'].includes(payload.applyTo || 'all')) errors.push('Invalid sale scope')
  if ((payload.applyTo || 'all') === 'category' && !payload.category) errors.push('Category is required for category sales')
  if ((payload.applyTo || 'all') === 'products' && (!Array.isArray(payload.productIds) || payload.productIds.length === 0)) {
    errors.push('Select at least one product for product-based sales')
  }
  return errors
}

const saleQuery = async (req) => {
  const { activeOnly } = req.query || {}
  const filter = {}
  if (activeOnly === 'true') filter.isActive = true
  const sales = await SaleCampaign.find(filter).sort({ priority: -1, startTime: 1, createdAt: -1 }).lean()
  return sales.map(summarizeSale)
}

exports.listSales = async (req, res, next) => {
  try {
    const sales = await saleQuery(req)
    const enriched = sales.map((sale) => ({
      ...sale,
      displayStatus: sale.isActive && sale.timeActive ? 'active' : 'inactive'
    }))
    res.json({ success: true, sales: enriched })
  } catch (error) {
    next(error)
  }
}

exports.getSale = async (req, res, next) => {
  try {
    const { identifier } = req.params
    const sale = await findSaleByIdentifier(identifier)

    if (!sale) {
      return res.status(404).json({ success: false, message: 'Sale not found' })
    }

    const saleSummary = summarizeSale(sale)
    const products = await getSaleProducts(sale)
    const productsWithSales = await attachSaleInfoToProducts(products)

    res.json({
      success: true,
      sale: saleSummary,
      products: productsWithSales,
      count: productsWithSales.length
    })
  } catch (error) {
    next(error)
  }
}

exports.createSale = async (req, res, next) => {
  try {
    const payload = {
      ...req.body,
      productIds: Array.isArray(req.body.productIds) ? req.body.productIds.filter(Boolean) : []
    }

    const errors = validateSalePayload(payload)
    if (errors.length > 0) {
      return res.status(400).json({ success: false, message: errors[0], errors })
    }

    const saleData = {
      name: String(payload.name).trim(),
      slug: payload.slug ? String(payload.slug).trim() : buildSaleSlug(payload.name),
      description: payload.description || '',
      startTime: parseDateTime(payload.startTime),
      endTime: parseDateTime(payload.endTime),
      isActive: payload.isActive !== false,
      applyTo: payload.applyTo || 'all',
      category: payload.category || '',
      productIds: payload.applyTo === 'products' ? payload.productIds : [],
      priority: Number.isFinite(Number(payload.priority)) ? Number(payload.priority) : 0,
      allowOverlap: Boolean(payload.allowOverlap),
      notes: payload.notes || ''
    }

    if (!saleData.allowOverlap) {
      const overlaps = await SaleCampaign.find({}).lean()
      const conflict = overlaps.find((existing) => hasSaleOverlapConflict(existing, saleData))
      if (conflict) {
        return res.status(409).json({
          success: false,
          message: `This sale conflicts with ${conflict.name}. Adjust the schedule or scope, or allow overlap.`,
          conflict: summarizeSale(conflict)
        })
      }
    }

    const sale = await SaleCampaign.create(saleData)
    res.status(201).json({ success: true, sale: summarizeSale(sale.toObject()) })
  } catch (error) {
    next(error)
  }
}

exports.updateSale = async (req, res, next) => {
  try {
    const existing = await SaleCampaign.findById(req.params.id)
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Sale not found' })
    }

    const payload = {
      ...req.body,
      productIds: Array.isArray(req.body.productIds) ? req.body.productIds.filter(Boolean) : []
    }

    const merged = {
      ...existing.toObject(),
      ...payload,
      productIds: payload.applyTo === 'products' ? payload.productIds : existing.productIds || []
    }

    const errors = validateSalePayload(merged)
    if (errors.length > 0) {
      return res.status(400).json({ success: false, message: errors[0], errors })
    }

    if (!merged.allowOverlap) {
      const others = await SaleCampaign.find({ _id: { $ne: existing._id } }).lean()
      const conflict = others.find((sale) => hasSaleOverlapConflict(sale, merged))
      if (conflict) {
        return res.status(409).json({
          success: false,
          message: `This sale conflicts with ${conflict.name}. Adjust the schedule or scope, or allow overlap.`,
          conflict: summarizeSale(conflict)
        })
      }
    }

    existing.name = String(merged.name).trim()
    existing.slug = merged.slug ? String(merged.slug).trim() : buildSaleSlug(merged.name)
    existing.description = merged.description || ''
    existing.startTime = parseDateTime(merged.startTime)
    existing.endTime = parseDateTime(merged.endTime)
    existing.isActive = merged.isActive !== false
    existing.applyTo = merged.applyTo || 'all'
    existing.category = merged.category || ''
    existing.productIds = merged.applyTo === 'products' ? merged.productIds : []
    existing.priority = Number.isFinite(Number(merged.priority)) ? Number(merged.priority) : 0
    existing.allowOverlap = Boolean(merged.allowOverlap)
    existing.notes = merged.notes || ''

    await existing.save()
    res.json({ success: true, sale: summarizeSale(existing.toObject()) })
  } catch (error) {
    next(error)
  }
}

exports.deleteSale = async (req, res, next) => {
  try {
    const sale = await SaleCampaign.findByIdAndDelete(req.params.id)
    if (!sale) {
      return res.status(404).json({ success: false, message: 'Sale not found' })
    }
    res.json({ success: true, message: 'Sale deleted successfully' })
  } catch (error) {
    next(error)
  }
}

exports.toggleSaleStatus = async (req, res, next) => {
  try {
    const { isActive } = req.body
    const sale = await SaleCampaign.findByIdAndUpdate(
      req.params.id,
      { isActive },
      { returnDocument: 'after', runValidators: true }
    ).lean()

    if (!sale) {
      return res.status(404).json({ success: false, message: 'Sale not found' })
    }

    res.json({ success: true, sale: summarizeSale(sale) })
  } catch (error) {
    next(error)
  }
}

exports.getSaleProducts = async (req, res, next) => {
  try {
    const { identifier } = req.params
    const sale = await findSaleByIdentifier(identifier)

    if (!sale) {
      return res.status(404).json({ success: false, message: 'Sale not found' })
    }

    const products = await getSaleProducts(sale)
    const enrichedProducts = await attachSaleInfoToProducts(products)

    res.json({
      success: true,
      sale: summarizeSale(sale),
      products: enrichedProducts,
      count: enrichedProducts.length
    })
  } catch (error) {
    next(error)
  }
}

exports.listPopups = async (req, res, next) => {
  try {
    const popups = await PopupBanner.find({}).populate('saleCampaignId').sort({ priority: -1, startTime: 1, createdAt: -1 }).lean()
    const enriched = popups.map((popup) => ({
      ...popup,
      effectiveStatus: popup.isActive && isWithinTimeWindow(popup.startTime, popup.endTime),
      linkedSale: popup.saleCampaignId ? summarizeSale(popup.saleCampaignId) : null
    }))
    res.json({ success: true, popups: enriched })
  } catch (error) {
    next(error)
  }
}

exports.getActivePopup = async (req, res, next) => {
  try {
    const popups = await PopupBanner.find({ isActive: true })
      .populate('saleCampaignId')
      .sort({ priority: -1, startTime: 1, createdAt: -1 })
      .lean()

    const popup = popups.find((item) => item.isActive && isWithinTimeWindow(item.startTime, item.endTime))
    if (!popup) {
      return res.json({ success: true, popup: null })
    }

    const linkedSale = popup.saleCampaignId ? summarizeSale(popup.saleCampaignId) : null
    const shopNowLink = linkedSale ? `/sales/${linkedSale.slug || linkedSale.id}` : (popup.customLink || '/products')

    res.json({
      success: true,
      popup: {
        ...popup,
        effectiveStatus: true,
        linkedSale,
        shopNowLink
      }
    })
  } catch (error) {
    next(error)
  }
}

exports.createPopup = async (req, res, next) => {
  try {
    const payload = req.body || {}
    if (!payload.title || !String(payload.title).trim()) {
      return res.status(400).json({ success: false, message: 'Popup title is required' })
    }
    if (!payload.startTime || !payload.endTime) {
      return res.status(400).json({ success: false, message: 'Popup start and end time are required' })
    }

    const popup = await PopupBanner.create({
      title: String(payload.title).trim(),
      description: payload.description || '',
      imageUrl: payload.imageUrl || '',
      startTime: parseDateTime(payload.startTime),
      endTime: parseDateTime(payload.endTime),
      isActive: payload.isActive !== false,
      saleCampaignId: payload.saleCampaignId || null,
      priority: Number.isFinite(Number(payload.priority)) ? Number(payload.priority) : 0,
      buttonText: payload.buttonText || 'Shop Now',
      customLink: payload.customLink || '',
      closeOnOutsideClick: payload.closeOnOutsideClick !== false
    })

    res.status(201).json({ success: true, popup })
  } catch (error) {
    next(error)
  }
}

exports.updatePopup = async (req, res, next) => {
  try {
    const popup = await PopupBanner.findById(req.params.id)
    if (!popup) {
      return res.status(404).json({ success: false, message: 'Popup not found' })
    }

    const payload = req.body || {}
    if (payload.title !== undefined) popup.title = String(payload.title).trim()
    if (payload.description !== undefined) popup.description = payload.description || ''
    if (payload.imageUrl !== undefined) popup.imageUrl = payload.imageUrl || ''
    if (payload.startTime !== undefined) popup.startTime = parseDateTime(payload.startTime)
    if (payload.endTime !== undefined) popup.endTime = parseDateTime(payload.endTime)
    if (payload.isActive !== undefined) popup.isActive = Boolean(payload.isActive)
    if (payload.saleCampaignId !== undefined) popup.saleCampaignId = payload.saleCampaignId || null
    if (payload.priority !== undefined) popup.priority = Number.isFinite(Number(payload.priority)) ? Number(payload.priority) : 0
    if (payload.buttonText !== undefined) popup.buttonText = payload.buttonText || 'Shop Now'
    if (payload.customLink !== undefined) popup.customLink = payload.customLink || ''
    if (payload.closeOnOutsideClick !== undefined) popup.closeOnOutsideClick = Boolean(payload.closeOnOutsideClick)

    await popup.save()
    res.json({ success: true, popup })
  } catch (error) {
    next(error)
  }
}

exports.deletePopup = async (req, res, next) => {
  try {
    const popup = await PopupBanner.findByIdAndDelete(req.params.id)
    if (!popup) {
      return res.status(404).json({ success: false, message: 'Popup not found' })
    }
    res.json({ success: true, message: 'Popup deleted successfully' })
  } catch (error) {
    next(error)
  }
}

exports.togglePopupStatus = async (req, res, next) => {
  try {
    const { isActive } = req.body
    const popup = await PopupBanner.findByIdAndUpdate(
      req.params.id,
      { isActive },
      { returnDocument: 'after', runValidators: true }
    ).lean()

    if (!popup) {
      return res.status(404).json({ success: false, message: 'Popup not found' })
    }

    res.json({ success: true, popup })
  } catch (error) {
    next(error)
  }
}

exports.getActiveSales = async (req, res, next) => {
  try {
    const sales = await getEffectiveSales({ isActive: true })
    res.json({ success: true, sales })
  } catch (error) {
    next(error)
  }
}

exports.getSaleProductsByIdentifier = async (req, res, next) => {
  try {
    const { identifier } = req.params
    const sale = await SaleCampaign.findOne({
      $or: [{ _id: identifier }, { slug: identifier }]
    }).lean()

    if (!sale) {
      return res.status(404).json({ success: false, message: 'Sale not found' })
    }

    const products = await getSaleProducts(sale)
    const productsWithSaleInfo = await attachSaleInfoToProducts(products)

    res.json({ success: true, sale: summarizeSale(sale), products: productsWithSaleInfo })
  } catch (error) {
    next(error)
  }
}

exports.getProductsWithSaleInfo = async (products = []) => {
  return attachSaleInfoToProducts(products)
}
