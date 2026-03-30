/**
 * One-time backfill for Product.listedBy using order history signals.
 *
 * Default mode is dry-run (no writes).
 *
 * Priority rules:
 * 1) Earliest admin/manager statusHistory.updatedBy from orders containing the product.
 * 2) Earliest admin/manager assignedBy from orders containing the product.
 * 3) Earliest admin/manager deliveryUpdates.updatedBy from orders containing the product.
 * 4) Optional fallback: if exactly one admin/manager exists system-wide, use that user.
 *
 * Usage:
 *   node scripts/backfill-product-listed-by.js
 *   node scripts/backfill-product-listed-by.js --commit
 *   node scripts/backfill-product-listed-by.js --commit --allow-single-admin-fallback
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('../src/models/Product');
const Order = require('../src/models/Order');
const User = require('../src/models/User');

const args = new Set(process.argv.slice(2));
const isCommitMode = args.has('--commit');
const allowSingleAdminFallback = args.has('--allow-single-admin-fallback');

const ROLE_ALLOWLIST = new Set(['admin', 'manager']);

function toIdString(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value.toString) return value.toString();
  return null;
}

function toDate(value, fallback = new Date(0)) {
  const parsed = value ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return fallback;
  return parsed;
}

function normalizeRoles(roles) {
  const roleArray = Array.isArray(roles) ? roles : (roles ? [roles] : []);
  return roleArray.map(role => String(role).toLowerCase().trim()).filter(Boolean);
}

function hasAdminOrManagerRole(roles) {
  return normalizeRoles(roles).some(role => ROLE_ALLOWLIST.has(role));
}

function isAdminOrManagerActor({ explicitRole, userId, roleByUserId }) {
  if (explicitRole && ROLE_ALLOWLIST.has(String(explicitRole).toLowerCase().trim())) {
    return true;
  }
  if (!userId) return false;
  return Boolean(roleByUserId.get(userId));
}

function chooseBestCandidate(productCreatedAt, candidates) {
  if (!candidates.length) return null;

  // Lower score wins:
  // - Rule priority dominates
  // - Within same rule, closest event time to product creation is preferred
  const createdAtMs = toDate(productCreatedAt).getTime();

  return candidates
    .map(candidate => {
      const eventAtMs = toDate(candidate.eventAt).getTime();
      const distance = Math.abs(eventAtMs - createdAtMs);
      return { ...candidate, distance };
    })
    .sort((a, b) => {
      if (a.rulePriority !== b.rulePriority) return a.rulePriority - b.rulePriority;
      if (a.distance !== b.distance) return a.distance - b.distance;
      if (a.eventAt && b.eventAt) {
        return toDate(a.eventAt).getTime() - toDate(b.eventAt).getTime();
      }
      return 0;
    })[0];
}

async function connectDB() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/doordripp';
  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB');
}

async function run() {
  await connectDB();

  const missingListedByFilter = {
    $or: [
      { listedBy: null },
      { listedBy: { $exists: false } }
    ]
  };

  const productsToBackfill = await Product.find(missingListedByFilter)
    .select('_id name createdAt listedBy')
    .lean();

  if (!productsToBackfill.length) {
    console.log('No products require listedBy backfill.');
    return;
  }

  console.log(`Found ${productsToBackfill.length} products without listedBy.`);

  const productIds = productsToBackfill.map(p => p._id);
  const productById = new Map(productsToBackfill.map(p => [toIdString(p._id), p]));

  const orders = await Order.find({ 'items.product': { $in: productIds } })
    .select('items.product createdAt statusHistory deliveryUpdates assignedBy')
    .lean();

  console.log(`Found ${orders.length} candidate orders containing these products.`);

  const actorIdSet = new Set();

  for (const order of orders) {
    const assignedById = toIdString(order.assignedBy);
    if (assignedById) actorIdSet.add(assignedById);

    for (const historyItem of (order.statusHistory || [])) {
      const actorId = toIdString(historyItem.updatedBy);
      if (actorId) actorIdSet.add(actorId);
    }

    for (const update of (order.deliveryUpdates || [])) {
      const actorId = toIdString(update.updatedBy);
      if (actorId) actorIdSet.add(actorId);
    }
  }

  const users = await User.find({ _id: { $in: Array.from(actorIdSet) } })
    .select('_id roles name email')
    .lean();

  const roleByUserId = new Map(
    users.map(user => [toIdString(user._id), hasAdminOrManagerRole(user.roles)])
  );

  const userInfoById = new Map(
    users.map(user => [
      toIdString(user._id),
      {
        id: toIdString(user._id),
        name: user.name || '',
        email: user.email || ''
      }
    ])
  );

  const candidatesByProductId = new Map();

  const pushCandidate = (productId, candidate) => {
    if (!candidatesByProductId.has(productId)) {
      candidatesByProductId.set(productId, []);
    }
    candidatesByProductId.get(productId).push(candidate);
  };

  for (const order of orders) {
    const relevantProductIds = new Set(
      (order.items || [])
        .map(item => toIdString(item.product))
        .filter(Boolean)
        .filter(pid => productById.has(pid))
    );

    if (!relevantProductIds.size) continue;

    const statusEvents = (order.statusHistory || []).map(event => ({
      userId: toIdString(event.updatedBy),
      explicitRole: event.updatedByRole,
      eventAt: event.timestamp || order.createdAt,
      rule: 'status-history',
      rulePriority: 1
    }));

    const assignedEvent = {
      userId: toIdString(order.assignedBy),
      explicitRole: null,
      eventAt: order.createdAt,
      rule: 'assigned-by',
      rulePriority: 2
    };

    const deliveryEvents = (order.deliveryUpdates || []).map(event => ({
      userId: toIdString(event.updatedBy),
      explicitRole: event.updatedByRole,
      eventAt: event.updatedAt || order.createdAt,
      rule: 'delivery-updates',
      rulePriority: 3
    }));

    const allEvents = [...statusEvents, assignedEvent, ...deliveryEvents]
      .filter(event => event.userId)
      .filter(event => isAdminOrManagerActor({
        explicitRole: event.explicitRole,
        userId: event.userId,
        roleByUserId
      }));

    if (!allEvents.length) continue;

    for (const productId of relevantProductIds) {
      for (const event of allEvents) {
        pushCandidate(productId, event);
      }
    }
  }

  let singleAdminFallback = null;

  if (allowSingleAdminFallback) {
    const adminManagerUsers = await User.find({
      $or: [
        { roles: 'admin' },
        { roles: 'manager' }
      ]
    }).select('_id name email').lean();

    if (adminManagerUsers.length === 1) {
      const fallbackUser = adminManagerUsers[0];
      singleAdminFallback = {
        id: toIdString(fallbackUser._id),
        name: fallbackUser.name || '',
        email: fallbackUser.email || ''
      };
      console.log(`Single admin/manager fallback enabled: ${singleAdminFallback.name || singleAdminFallback.email}`);
    } else {
      console.log(`Single admin fallback not applied (found ${adminManagerUsers.length} admin/manager users).`);
    }
  }

  const updates = [];
  const unresolved = [];
  const ruleCounter = {
    'status-history': 0,
    'assigned-by': 0,
    'delivery-updates': 0,
    'single-admin-fallback': 0
  };

  for (const product of productsToBackfill) {
    const productId = toIdString(product._id);
    const candidates = candidatesByProductId.get(productId) || [];
    const best = chooseBestCandidate(product.createdAt, candidates);

    if (best) {
      updates.push({
        productId,
        productName: product.name,
        listedBy: best.userId,
        rule: best.rule,
        eventAt: best.eventAt,
        actor: userInfoById.get(best.userId) || { id: best.userId, name: '', email: '' }
      });
      ruleCounter[best.rule] += 1;
      continue;
    }

    if (singleAdminFallback) {
      updates.push({
        productId,
        productName: product.name,
        listedBy: singleAdminFallback.id,
        rule: 'single-admin-fallback',
        eventAt: null,
        actor: singleAdminFallback
      });
      ruleCounter['single-admin-fallback'] += 1;
      continue;
    }

    unresolved.push({
      productId,
      productName: product.name
    });
  }

  console.log(`Planned updates: ${updates.length}`);
  console.log(`Unresolved: ${unresolved.length}`);
  console.log('Rule distribution:', ruleCounter);

  if (!isCommitMode) {
    console.log('Dry-run mode: no database updates were made. Use --commit to apply changes.');
  } else {
    let applied = 0;

    for (const item of updates) {
      const result = await Product.updateOne(
        {
          _id: item.productId,
          $or: [
            { listedBy: null },
            { listedBy: { $exists: false } }
          ]
        },
        { $set: { listedBy: item.listedBy } }
      );

      if (result.modifiedCount > 0) {
        applied += 1;
      }
    }

    console.log(`Applied updates: ${applied}`);
  }

  const preview = updates.slice(0, 20).map(item => ({
    product: item.productName,
    listedByName: item.actor.name,
    listedByEmail: item.actor.email,
    rule: item.rule
  }));

  console.log('Sample updates (max 20):');
  console.table(preview);

  if (unresolved.length) {
    console.log('Sample unresolved products (max 20):');
    console.table(unresolved.slice(0, 20));
  }
}

run()
  .catch(err => {
    console.error('Backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch {
      // Ignore disconnect errors.
    }
  });
