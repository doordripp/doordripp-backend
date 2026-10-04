/**
 * Atomic stock reservation.
 *
 * Stock is never read, changed in memory and written back. Every decrement is a
 * single conditional update ("decrement only if at least N are left"), which the
 * database applies atomically per document. Two buyers racing for the last unit
 * therefore cannot both succeed, and stock can never go below zero.
 *
 * All functions take a mongoose session so they take part in the caller's
 * transaction: if any line of an order cannot be reserved, every reservation
 * made for that order is rolled back together with the order itself.
 */

const mongoose = require('mongoose');
const Product = require('../models/Product');
const { normalizeSizeLabel } = require('../utils/productInventory');

class StockError extends Error {
  constructor(message, items = []) {
    super(message);
    this.name = 'StockError';
    this.status = 409;
    this.code = 'OUT_OF_STOCK';
    this.items = items;
  }
}

/** Collapse duplicate product+size lines and validate quantities. */
function normalizeReservation(lines = []) {
  const merged = new Map();
  for (const line of lines) {
    const productId = line && (line.product && line.product._id ? line.product._id : line.product);
    const quantity = Number(line && line.quantity != null ? line.quantity : 1);
    if (!productId || !mongoose.Types.ObjectId.isValid(String(productId))) {
      throw new StockError('Invalid product in order');
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new StockError('Invalid quantity in order');
    }
    const size = normalizeSizeLabel(line.size);
    const key = `${productId}::${size}`;
    const existing = merged.get(key);
    if (existing) existing.quantity += quantity;
    else merged.set(key, { product: new mongoose.Types.ObjectId(String(productId)), size, quantity, name: line.name });
  }
  // Stable order so two transactions touching the same products lock them in the same sequence.
  return Array.from(merged.values()).sort((a, b) =>
    `${a.product}::${a.size}`.localeCompare(`${b.product}::${b.size}`));
}

async function reserveLine(line, session) {
  // Size-tracked product: decrement that size only if enough remain.
  const sized = await Product.updateOne(
    { _id: line.product, sizeInventory: { $elemMatch: { size: line.size, stock: { $gte: line.quantity } } } },
    { $inc: { 'sizeInventory.$.stock': -line.quantity, stock: -line.quantity } },
    { session }
  );
  if (sized.modifiedCount === 1) return true;

  // Legacy product without per-size inventory: fall back to the flat stock counter.
  const flat = await Product.updateOne(
    { _id: line.product, 'sizeInventory.0': { $exists: false }, stock: { $gte: line.quantity } },
    { $inc: { stock: -line.quantity } },
    { session }
  );
  return flat.modifiedCount === 1;
}

/**
 * Reserve every line or throw StockError (the caller's transaction then aborts).
 * @returns {Promise<Array<{product, size, quantity}>>} what was reserved
 */
async function reserveStock(lines, session) {
  const reservation = normalizeReservation(lines);
  for (const line of reservation) {
    const ok = await reserveLine(line, session);
    if (!ok) {
      const label = line.name ? `"${line.name}"` : 'an item';
      throw new StockError(
        `Out of stock for ${label}${line.size ? ` in size ${line.size}` : ''}.`,
        [{ product: String(line.product), size: line.size, requestedQuantity: line.quantity }]
      );
    }
  }
  return reservation.map(({ product, size, quantity }) => ({ product, size, quantity }));
}

/** Put reserved units back (failed payment, cancellation, expiry). */
async function releaseStock(lines, session) {
  const reservation = normalizeReservation(lines);
  for (const line of reservation) {
    const sized = await Product.updateOne(
      { _id: line.product, 'sizeInventory.size': line.size },
      { $inc: { 'sizeInventory.$.stock': line.quantity, stock: line.quantity } },
      { session }
    );
    if (sized.modifiedCount === 1) continue;
    await Product.updateOne(
      { _id: line.product, 'sizeInventory.0': { $exists: false } },
      { $inc: { stock: line.quantity } },
      { session }
    );
  }
}

module.exports = { StockError, normalizeReservation, reserveStock, releaseStock };
