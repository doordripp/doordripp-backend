const DeliveryChargeConfig = require('../models/DeliveryChargeConfig');

const DEFAULT_DELIVERY_OPTIONS = [
  {
    id: 'priority',
    label: 'Priority Delivery',
    sublabel: 'Fastest',
    eta: '25 minutes',
    charge: 100,
    badge: 'FAST',
    isActive: true,
    sortOrder: 1
  },
  {
    id: 'standard',
    label: 'Standard Delivery',
    sublabel: 'Best Value',
    eta: '35 minutes',
    charge: 80,
    badge: 'BEST',
    isActive: true,
    sortOrder: 2
  },
  {
    id: 'regular',
    label: 'Regular Delivery',
    sublabel: 'Economical',
    eta: '45 minutes',
    charge: 60,
    badge: 'ECO',
    isActive: true,
    sortOrder: 3
  }
];

const ALLOWED_OPTION_IDS = new Set(['regular', 'standard', 'priority']);

function normalizeDeliveryOptions(inputOptions) {
  if (!Array.isArray(inputOptions) || inputOptions.length === 0) {
    return DEFAULT_DELIVERY_OPTIONS.map((option) => ({ ...option }));
  }

  const byId = new Map();

  for (const raw of inputOptions) {
    if (!raw || !ALLOWED_OPTION_IDS.has(raw.id)) continue;
    byId.set(raw.id, {
      id: raw.id,
      label: String(raw.label || '').trim() || raw.id,
      sublabel: String(raw.sublabel || '').trim(),
      eta: String(raw.eta || '').trim() || '45 minutes',
      charge: Number.isFinite(Number(raw.charge)) ? Math.max(0, Number(raw.charge)) : 0,
      badge: String(raw.badge || '').trim(),
      isActive: raw.isActive !== false,
      sortOrder: Number.isFinite(Number(raw.sortOrder)) ? Number(raw.sortOrder) : 0
    });
  }

  for (const fallback of DEFAULT_DELIVERY_OPTIONS) {
    if (!byId.has(fallback.id)) byId.set(fallback.id, { ...fallback });
  }

  return Array.from(byId.values()).sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.id.localeCompare(b.id);
  });
}

function normalizeDefaultType(defaultType, options) {
  const activeOptions = options.filter((o) => o.isActive);
  if (activeOptions.length === 0) {
    return 'regular';
  }

  if (defaultType && activeOptions.some((o) => o.id === defaultType)) {
    return defaultType;
  }

  if (activeOptions.some((o) => o.id === 'regular')) {
    return 'regular';
  }

  return activeOptions[0].id;
}

async function getDeliveryChargeConfig() {
  const configDoc = await DeliveryChargeConfig.findOne({ key: 'default' }).lean();
  const options = normalizeDeliveryOptions(configDoc?.options);
  const defaultDeliveryType = normalizeDefaultType(configDoc?.defaultDeliveryType, options);

  return {
    options,
    defaultDeliveryType
  };
}

async function upsertDeliveryChargeConfig({ options, defaultDeliveryType, updatedBy }) {
  const normalizedOptions = normalizeDeliveryOptions(options);
  const normalizedDefault = normalizeDefaultType(defaultDeliveryType, normalizedOptions);

  const update = {
    key: 'default',
    options: normalizedOptions,
    defaultDeliveryType: normalizedDefault,
    updatedBy: updatedBy || undefined
  };

  await DeliveryChargeConfig.findOneAndUpdate(
    { key: 'default' },
    { $set: update },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  return {
    options: normalizedOptions,
    defaultDeliveryType: normalizedDefault
  };
}

function pickDeliveryOption(config, requestedType) {
  const options = config?.options || [];
  const activeOptions = options.filter((o) => o.isActive);
  const pool = activeOptions.length > 0 ? activeOptions : options;

  if (pool.length === 0) {
    const fallback = DEFAULT_DELIVERY_OPTIONS.find((o) => o.id === 'regular');
    return { ...fallback };
  }

  const byId = new Map(pool.map((o) => [o.id, o]));
  if (requestedType && byId.has(requestedType)) return byId.get(requestedType);

  const defaultType = config?.defaultDeliveryType;
  if (defaultType && byId.has(defaultType)) return byId.get(defaultType);

  if (byId.has('regular')) return byId.get('regular');
  return pool[0];
}

module.exports = {
  DEFAULT_DELIVERY_OPTIONS,
  ALLOWED_OPTION_IDS,
  getDeliveryChargeConfig,
  upsertDeliveryChargeConfig,
  pickDeliveryOption
};
