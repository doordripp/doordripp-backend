const Voucher = require('../models/Voucher');
const escapeRegex = require('../utils/escapeRegex');

const parseOptionalNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
};

const parseBoolean = (value, fallback = true) => {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
};

exports.listVouchers = async (req, res, next) => {
  try {
    const { search = '', isActive, page = 1, limit = 50 } = req.query;
    const safePage = Math.max(parseInt(page, 10) || 1, 1);
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const skip = (safePage - 1) * safeLimit;

    const filter = {};

    if (search && String(search).trim()) {
      filter.code = { $regex: escapeRegex(String(search).trim().toUpperCase()), $options: 'i' };
    }

    if (isActive === 'true' || isActive === 'false') {
      filter.isActive = isActive === 'true';
    }

    const [vouchers, total] = await Promise.all([
      Voucher.find(filter).sort({ createdAt: -1 }).skip(skip).limit(safeLimit),
      Voucher.countDocuments(filter)
    ]);

    return res.json({
      vouchers,
      pagination: {
        total,
        page: safePage,
        limit: safeLimit,
        pages: Math.ceil(total / safeLimit)
      }
    });
  } catch (err) {
    return next(err);
  }
};

exports.createVoucher = async (req, res, next) => {
  try {
    const {
      code,
      discountType,
      discountValue,
      maxDiscount,
      minOrderValue,
      expiryDate,
      usageLimit,
      perUserLimit,
      isActive = true
    } = req.body || {};

    const normalizedCode = String(code || '').trim().toUpperCase();
    if (!normalizedCode) {
      return res.status(400).json({ error: 'Voucher code is required' });
    }
    if (!/^[A-Z0-9_-]{3,30}$/.test(normalizedCode)) {
      return res.status(400).json({ error: 'Voucher code must be 3-30 chars (A-Z, 0-9, _, -)' });
    }

    if (!['percentage', 'fixed'].includes(discountType)) {
      return res.status(400).json({ error: 'discountType must be percentage or fixed' });
    }

    const parsedDiscountValue = Number(discountValue);
    if (!Number.isFinite(parsedDiscountValue) || parsedDiscountValue <= 0) {
      return res.status(400).json({ error: 'discountValue must be greater than 0' });
    }
    if (discountType === 'percentage' && parsedDiscountValue > 100) {
      return res.status(400).json({ error: 'Percentage discount cannot exceed 100' });
    }

    const parsedMinOrderValue = parseOptionalNumber(minOrderValue);
    if (parsedMinOrderValue !== null && (!Number.isFinite(parsedMinOrderValue) || parsedMinOrderValue < 0)) {
      return res.status(400).json({ error: 'minOrderValue must be 0 or greater' });
    }

    const parsedMaxDiscount = parseOptionalNumber(maxDiscount);
    if (parsedMaxDiscount !== null && (!Number.isFinite(parsedMaxDiscount) || parsedMaxDiscount < 0)) {
      return res.status(400).json({ error: 'maxDiscount must be 0 or greater' });
    }

    const parsedUsageLimit = parseOptionalNumber(usageLimit);
    if (parsedUsageLimit !== null && (!Number.isInteger(parsedUsageLimit) || parsedUsageLimit < 1)) {
      return res.status(400).json({ error: 'usageLimit must be an integer >= 1 or empty' });
    }

    const parsedPerUserLimit = parseOptionalNumber(perUserLimit);
    if (parsedPerUserLimit !== null && (!Number.isInteger(parsedPerUserLimit) || parsedPerUserLimit < 1)) {
      return res.status(400).json({ error: 'perUserLimit must be an integer >= 1 or empty' });
    }

    if (
      parsedUsageLimit !== null &&
      parsedPerUserLimit !== null &&
      parsedPerUserLimit > parsedUsageLimit
    ) {
      return res.status(400).json({ error: 'perUserLimit cannot exceed usageLimit' });
    }

    let parsedExpiryDate = null;
    if (expiryDate) {
      const candidate = new Date(expiryDate);
      if (Number.isNaN(candidate.getTime())) {
        return res.status(400).json({ error: 'Invalid expiryDate' });
      }
      if (candidate <= new Date()) {
        return res.status(400).json({ error: 'expiryDate must be in the future' });
      }
      parsedExpiryDate = candidate;
    }

    const voucher = await Voucher.create({
      code: normalizedCode,
      discountType,
      discountValue: parsedDiscountValue,
      maxDiscount: discountType === 'percentage' ? parsedMaxDiscount : null,
      minOrderValue: parsedMinOrderValue ?? 0,
      expiryDate: parsedExpiryDate,
      usageLimit: parsedUsageLimit,
      perUserLimit: parsedPerUserLimit ?? 1,
      isActive: parseBoolean(isActive, true),
      usedCount: 0
    });

    return res.status(201).json({
      message: 'Voucher created successfully',
      voucher
    });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ error: 'Voucher code already exists' });
    }
    return next(err);
  }
};

exports.toggleVoucherStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const voucher = await Voucher.findById(id);
    if (!voucher) {
      return res.status(404).json({ error: 'Voucher not found' });
    }

    voucher.isActive = !voucher.isActive;
    await voucher.save();

    return res.json({
      message: `Voucher ${voucher.isActive ? 'activated' : 'deactivated'} successfully`,
      voucher
    });
  } catch (err) {
    return next(err);
  }
};

module.exports = exports;
