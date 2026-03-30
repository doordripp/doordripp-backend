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

async function consumeVoucherUsage({ voucherId, userId }) {
  if (!voucherId || !userId) return

  const now = new Date()
  const voucherFilter = {
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
  }

  const updatedVoucher = await Voucher.findOneAndUpdate(
    voucherFilter,
    { $inc: { usedCount: 1 } },
    { returnDocument: 'after' }
  )

  if (!updatedVoucher) {
    throw new VoucherError('Voucher is no longer available')
  }

  try {
    if (updatedVoucher.perUserLimit === null || updatedVoucher.perUserLimit === undefined) {
      await VoucherUsage.findOneAndUpdate(
        { voucher: voucherId, user: userId },
        { $inc: { count: 1 }, $setOnInsert: { voucher: voucherId, user: userId } },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
      )
      return
    }

    const userUsage = await VoucherUsage.findOneAndUpdate(
      {
        voucher: voucherId,
        user: userId,
        count: { $lt: updatedVoucher.perUserLimit }
      },
      { $inc: { count: 1 }, $setOnInsert: { voucher: voucherId, user: userId } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    )

    if (!userUsage || userUsage.count > updatedVoucher.perUserLimit) {
      await Voucher.findByIdAndUpdate(voucherId, { $inc: { usedCount: -1 } })
      throw new VoucherError('Per-user voucher limit reached')
    }
  } catch (err) {
    if (err?.code === 11000) {
      await Voucher.findByIdAndUpdate(voucherId, { $inc: { usedCount: -1 } })
      throw new VoucherError('Per-user voucher limit reached')
    }

    if (err instanceof VoucherError) {
      throw err
    }

    await Voucher.findByIdAndUpdate(voucherId, { $inc: { usedCount: -1 } })
    throw err
  }
}

module.exports = {
  VoucherError,
  normalizeCode,
  validateVoucherForUser,
  consumeVoucherUsage
}
