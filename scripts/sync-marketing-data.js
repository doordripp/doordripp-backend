require('dotenv').config()
const fs = require('fs/promises')
const path = require('path')
const mongoose = require('mongoose')

const SaleCampaign = require('../src/models/SaleCampaign')
const PopupBanner = require('../src/models/PopupBanner')
const { buildSaleSlug } = require('../src/utils/promotionHelpers')

const DEFAULT_DATA_FILE = path.join(__dirname, 'marketing-sync.json')
const IST_OFFSET = '+05:30'

const parseArgs = (argv) => {
  const options = { file: DEFAULT_DATA_FILE, dryRun: false }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--file' || arg === '-f') {
      options.file = argv[index + 1] || options.file
      index += 1
      continue
    }
    if (arg.startsWith('--file=')) {
      options.file = arg.slice('--file='.length)
      continue
    }
    if (arg === '--dry-run') {
      options.dryRun = true
    }
  }

  return options
}

const hasTimezoneSuffix = (value) => /([zZ]|[+-]\d\d:?\d\d)$/.test(String(value || '').trim())

const parseDateTime = (value) => {
  if (!value) return null
  if (value instanceof Date) return value

  const normalizedValue = String(value).trim()
  if (!normalizedValue) return null

  const date = hasTimezoneSuffix(normalizedValue)
    ? new Date(normalizedValue)
    : new Date(`${normalizedValue.length === 16 ? `${normalizedValue}:00` : normalizedValue}${IST_OFFSET}`)

  return Number.isNaN(date.getTime()) ? null : date
}

const isValidObjectId = (value) => mongoose.isValidObjectId(value)

const toObjectIdStrings = (values = []) => {
  const invalidValues = []
  const normalized = []

  for (const value of values) {
    if (!value) continue
    const stringValue = String(value).trim()
    if (!stringValue) continue
    if (!isValidObjectId(stringValue)) {
      invalidValues.push(stringValue)
      continue
    }
    normalized.push(stringValue)
  }

  return { normalized, invalidValues }
}

const loadJsonFile = async (filePath) => {
  await fs.access(filePath)
  const raw = await fs.readFile(filePath, 'utf8')
  return JSON.parse(raw)
}

const normalizeEntry = (entry = {}) => ({
  match: entry.match || {},
  data: entry.data || entry
})

const buildSaleMatchQuery = (entry) => {
  const { match, data } = normalizeEntry(entry)

  if (match._id && isValidObjectId(match._id)) return { _id: match._id }
  if (match.slug) return { slug: String(match.slug).trim() }
  if (data._id && isValidObjectId(data._id)) return { _id: data._id }
  if (data.slug) return { slug: String(data.slug).trim() }
  if (data.name) return { slug: buildSaleSlug(String(data.name).trim()) }

  throw new Error('Each sale entry needs match._id, match.slug, data.slug, or data.name')
}

const buildPopupMatchQuery = (entry) => {
  const { match, data } = normalizeEntry(entry)

  if (match._id && isValidObjectId(match._id)) return { _id: match._id }
  if (match.title) return { title: String(match.title).trim() }
  if (data._id && isValidObjectId(data._id)) return { _id: data._id }
  if (data.title) return { title: String(data.title).trim() }

  throw new Error('Each popup entry needs match._id, match.title, data._id, or data.title')
}

const buildSalePayload = (entry) => {
  const { data } = normalizeEntry(entry)
  const productIds = Array.isArray(data.productIds) ? data.productIds : []
  const normalizedProductIds = toObjectIdStrings(productIds)

  return {
    name: String(data.name || '').trim(),
    slug: data.slug ? String(data.slug).trim() : buildSaleSlug(String(data.name || '').trim()),
    description: data.description || '',
    startTime: parseDateTime(data.startTime),
    endTime: parseDateTime(data.endTime),
    isActive: data.isActive !== false,
    applyTo: data.applyTo || 'all',
    category: data.category || '',
    productIds: normalizedProductIds.normalized,
    priority: Number.isFinite(Number(data.priority)) ? Number(data.priority) : 0,
    allowOverlap: Boolean(data.allowOverlap),
    notes: data.notes || '',
    invalidProductIds: normalizedProductIds.invalidValues
  }
}

const resolveSaleCampaignId = async (value, saleIndex) => {
  if (!value) return null

  const stringValue = String(value).trim()
  if (!stringValue) return null

  if (isValidObjectId(stringValue)) return stringValue
  if (saleIndex.has(stringValue)) return saleIndex.get(stringValue)

  const sale = await SaleCampaign.findOne({ slug: stringValue }).lean()
  return sale ? String(sale._id) : null
}

const buildPopupPayload = async (entry, saleIndex) => {
  const { data } = normalizeEntry(entry)
  const resolvedSaleCampaignId = await resolveSaleCampaignId(
    data.saleCampaignId || data.saleCampaignSlug || data.saleCampaign,
    saleIndex
  )

  return {
    title: String(data.title || '').trim(),
    description: data.description || '',
    imageUrl: data.imageUrl || '',
    startTime: parseDateTime(data.startTime),
    endTime: parseDateTime(data.endTime),
    isActive: data.isActive !== false,
    saleCampaignId: resolvedSaleCampaignId,
    priority: Number.isFinite(Number(data.priority)) ? Number(data.priority) : 0,
    buttonText: data.buttonText || 'Shop Now',
    customLink: data.customLink || '',
    closeOnOutsideClick: data.closeOnOutsideClick !== false
  }
}

const upsertSale = async (entry, dryRun) => {
  const query = buildSaleMatchQuery(entry)
  const payload = buildSalePayload(entry)

  if (!payload.name) {
    throw new Error('Sale name is required')
  }
  if (!payload.startTime || !payload.endTime) {
    throw new Error(`Sale ${payload.name} needs valid startTime and endTime values`)
  }
  if (!['all', 'category', 'products'].includes(payload.applyTo)) {
    throw new Error(`Sale ${payload.name} has an invalid applyTo value`)
  }
  if (payload.applyTo === 'category' && !payload.category) {
    throw new Error(`Sale ${payload.name} needs a category when applyTo is category`)
  }
  if (payload.applyTo === 'products' && payload.productIds.length === 0) {
    throw new Error(`Sale ${payload.name} needs at least one valid productId when applyTo is products`)
  }

  if (payload.invalidProductIds.length > 0) {
    console.warn(`[warn] Sale ${payload.name} has invalid productIds that will be skipped: ${payload.invalidProductIds.join(', ')}`)
  }

  if (dryRun) {
    return { action: 'dry-run', model: 'SaleCampaign', query, payload }
  }

  const existing = await SaleCampaign.findOne(query)
  if (existing) {
    Object.assign(existing, payload)
    await existing.save()
    return { action: 'updated', doc: existing.toObject() }
  }

  const created = await SaleCampaign.create(payload)
  return { action: 'created', doc: created.toObject() }
}

const upsertPopup = async (entry, saleIndex, dryRun) => {
  const query = buildPopupMatchQuery(entry)
  const payload = await buildPopupPayload(entry, saleIndex)

  if (!payload.title) {
    throw new Error('Popup title is required')
  }
  if (!payload.startTime || !payload.endTime) {
    throw new Error(`Popup ${payload.title} needs valid startTime and endTime values`)
  }

  if (dryRun) {
    return { action: 'dry-run', model: 'PopupBanner', query, payload }
  }

  const existing = await PopupBanner.findOne(query)
  if (existing) {
    Object.assign(existing, payload)
    await existing.save()
    return { action: 'updated', doc: existing.toObject() }
  }

  const created = await PopupBanner.create(payload)
  return { action: 'created', doc: created.toObject() }
}

const connectDB = async () => {
  const uri = process.env.MONGO_URI || process.env.DATABASE_URL
  if (!uri) {
    throw new Error('MONGO_URI or DATABASE_URL must be set')
  }

  await mongoose.connect(uri)
}

const run = async () => {
  const options = parseArgs(process.argv.slice(2))
  const filePath = path.isAbsolute(options.file) ? options.file : path.join(process.cwd(), options.file)

  console.log(`[sync] Loading marketing sync data from ${filePath}`)
  let content
  try {
    content = await loadJsonFile(filePath)
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Marketing sync file not found: ${filePath}. Pass --file <path> or create scripts/marketing-sync.json.`)
    }
    throw error
  }
  const sales = Array.isArray(content.sales) ? content.sales : []
  const popups = Array.isArray(content.popups) ? content.popups : []

  await connectDB()
  console.log('[sync] Connected to MongoDB')

  const saleIndex = new Map()
  let createdSales = 0
  let updatedSales = 0
  let createdPopups = 0
  let updatedPopups = 0

  for (const saleEntry of sales) {
    const result = await upsertSale(saleEntry, options.dryRun)
    if (result.action === 'created') createdSales += 1
    if (result.action === 'updated') updatedSales += 1

    const saleDoc = result.doc || buildSalePayload(saleEntry)
    if (saleDoc.slug && saleDoc._id) {
      saleIndex.set(String(saleDoc.slug), String(saleDoc._id))
    }
    if (saleDoc._id) {
      saleIndex.set(String(saleDoc._id), String(saleDoc._id))
    }

    console.log(`[${result.action}] Sale: ${saleDoc.name || saleDoc.slug}`)
  }

  for (const popupEntry of popups) {
    const result = await upsertPopup(popupEntry, saleIndex, options.dryRun)
    if (result.action === 'created') createdPopups += 1
    if (result.action === 'updated') updatedPopups += 1

    const popupDoc = result.doc || await buildPopupPayload(popupEntry, saleIndex)
    console.log(`[${result.action}] Popup: ${popupDoc.title}`)
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`Sales:   ${options.dryRun ? 'dry run' : `${createdSales} created, ${updatedSales} updated`}`)
  console.log(`Popups:  ${options.dryRun ? 'dry run' : `${createdPopups} created, ${updatedPopups} updated`}`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
}

run()
  .catch((error) => {
    console.error('[error] Marketing sync failed:', error.message)
    process.exitCode = 1
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect()
      console.log('[sync] Disconnected from MongoDB')
    }
  })