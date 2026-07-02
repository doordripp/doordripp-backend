const voucherService = require('../services/voucher.service')

exports.applyVoucher = async (req, res, next) => {
  try {
    const { code, cartTotal } = req.body

    const result = await voucherService.validateVoucherForUser({
      code,
      cartTotal,
      userId: req.user?.id
    })

    return res.json({
      code: result.voucher.code,
      voucherId: result.voucher._id,
      discountType: result.voucher.discountType,
      discountValue: result.voucher.discountValue,
      discount: result.discount,
      originalPrice: result.originalPrice,
      finalPrice: result.finalPrice
    })
  } catch (err) {
    if (err?.name === 'VoucherError') {
      return res.status(err.status || 400).json({ error: err.message })
    }
    return next(err)
  }
}

module.exports = exports
