const Voucher = require('../models/Voucher')
const VoucherUsage = require('../models/VoucherUsage')

class VoucherError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.name = 'VoucherError'
    this.status = status
  }
}

const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100

const normalizeCode = (code) => {
  if (typeof code !== 'string') return ''
  return code.trim().toUpperCase()
}

const toPositiveAmount = (amount) => {
  const parsed = Number(amount)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return roundMoney(parsed)
}

const calculateDiscount = (voucher, cartTotal) => {
  let discount = 0

  if (voucher.discountType === 'percentage') {
    discount = cartTotal * (voucher.discountValue / 100)
    if (voucher.maxDiscount !== null && voucher.maxDiscount !== undefined) {
      discount = Math.min(discount, voucher.maxDiscount)
    }
  } else {
    discount = voucher.discountValue
  }

  discount = Math.min(roundMoney(discount), cartTotal)
  return discount < 0 ? 0 : discount
}

async function getUserUsageCount(voucherId, userId) {
  if (!userId) return 0
  const usage = await VoucherUsage.findOne({ voucher: voucherId, user: userId }).lean()
  return usage?.count || 0
}

async function validateVoucherForUser({ code, cartTotal, userId }) {
  const normalizedCode = normalizeCode(code)
  if (!normalizedCode) {
    throw new VoucherError('Voucher code is required')
  }

  const safeCartTotal = toPositiveAmount(cartTotal)
  if (safeCartTotal === null) {
    throw new VoucherError('Invalid cart total')
  }

  const voucher = await Voucher.findOne({ code: normalizedCode, isActive: true })
  if (!voucher) {
    throw new VoucherError('Invalid voucher')
  }

  const now = new Date()

  if (voucher.expiryDate && voucher.expiryDate < now) {
    throw new VoucherError('Voucher expired')
  }

  if (voucher.minOrderValue > safeCartTotal) {
    throw new VoucherError(`Minimum order value is ${voucher.minOrderValue}`)
  }

  if (voucher.usageLimit !== null && voucher.usedCount >= voucher.usageLimit) {
    throw new VoucherError('Voucher usage limit reached')
  }

  const userUsage = await getUserUsageCount(voucher._id, userId)
  if (voucher.perUserLimit !== null && userUsage >= voucher.perUserLimit) {
    throw new VoucherError('Per-user voucher limit reached')
  }

  const discount = calculateDiscount(voucher, safeCartTotal)
  const finalPrice = roundMoney(safeCartTotal - discount)

  return {
    voucher,
    discount,
    finalPrice,
    originalPrice: safeCartTotal
  }
}

const activeVoucherFilter = (voucherId, now = new Date()) => ({
  _id: voucherId,
  isActive: true,
  $or: [
    { expiryDate: { $exists: false } },
    { expiryDate: null },
    { expiryDate: { $gt: now } }
  ],
  $and: [
    {
      $or: [
        { usageLimit: { $exists: false } },
        { usageLimit: null },
        { $expr: { $lt: ['$usedCount', '$usageLimit'] } }
      ]
    }
  ]
})

/**
 * Make sure the per-user usage row exists. Done OUTSIDE the order transaction:
 * an upsert that loses a race raises a duplicate-key error, and inside a
 * transaction that would abort the whole order.
 */
async function ensureUsageRow(voucherId, userId) {
  try {
    await VoucherUsage.updateOne(
      { voucher: voucherId, user: userId },
      { $setOnInsert: { voucher: voucherId, user: userId, count: 0 } },
      { upsert: true }
    )
  } catch (err) {
    if (err?.code !== 11000) throw err
  }
}

/**
 * Atomically claim one use of a voucher for a user, inside the caller's transaction.
 *
 * Both counters move with conditional updates ("increment only while below the
 * limit"), so two simultaneous checkouts cannot both take the last use. Because
 * it shares the order's transaction, the claim only exists if the order exists:
 * a failed order never leaves a voucher consumed.
 *
 * Call ensureUsageRow() before starting the transaction.
 */
async function claimVoucher({ voucherId, userId, session }) {
  if (!voucherId || !userId) throw new VoucherError('Invalid voucher')

  const voucher = await Voucher.findOneAndUpdate(
    activeVoucherFilter(voucherId),
    { $inc: { usedCount: 1 } },
    { returnDocument: 'after', session }
  )
  if (!voucher) {
    throw new VoucherError('Voucher is no longer available')
  }

  const usageFilter = { voucher: voucherId, user: userId }
  if (voucher.perUserLimit !== null && voucher.perUserLimit !== undefined) {
    usageFilter.count = { $lt: voucher.perUserLimit }
  }
  const usage = await VoucherUsage.updateOne(usageFilter, { $inc: { count: 1 } }, { session })
  if (usage.modifiedCount !== 1) {
    // Thrown inside the transaction, so the usedCount increment above is rolled back too.
    throw new VoucherError('Per-user voucher limit reached')
  }
  return voucher
}

/** Give a claimed use back (payment failed, order cancelled or expired). Never goes below zero. */
async function releaseVoucher({ voucherId, userId, session }) {
  if (!voucherId || !userId) return
  await Voucher.updateOne({ _id: voucherId, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } }, { session })
  await VoucherUsage.updateOne(
    { voucher: voucherId, user: userId, count: { $gt: 0 } },
    { $inc: { count: -1 } },
    { session }
  )
}

module.exports = {
  VoucherError,
  normalizeCode,
  validateVoucherForUser,
  ensureUsageRow,
  claimVoucher,
  releaseVoucher
}
