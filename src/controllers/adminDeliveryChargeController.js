const logger = require('../utils/logger');
const {
  getDeliveryChargeConfig,
  upsertDeliveryChargeConfig,
  ALLOWED_OPTION_IDS
} = require('../utils/deliveryChargeConfig');

function validatePayload(body) {
  if (!Array.isArray(body?.options) || body.options.length === 0) {
    return 'At least one delivery option is required';
  }

  const seenIds = new Set();

  for (const option of body.options) {
    if (!option || typeof option !== 'object') return 'Invalid delivery option payload';
    if (!ALLOWED_OPTION_IDS.has(option.id)) return `Unsupported delivery option id: ${option.id}`;
    if (seenIds.has(option.id)) return `Duplicate delivery option id: ${option.id}`;
    seenIds.add(option.id);

    if (!String(option.label || '').trim()) return `Label is required for ${option.id}`;
    if (!String(option.eta || '').trim()) return `ETA is required for ${option.id}`;
    const charge = Number(option.charge);
    if (!Number.isFinite(charge) || charge < 0) return `Charge must be a non-negative number for ${option.id}`;
  }

  const activeCount = body.options.filter((option) => option.isActive !== false).length;
  if (activeCount === 0) {
    return 'At least one delivery option must remain active';
  }

  return null;
}

exports.getDeliveryChargeConfig = async (req, res) => {
  try {
    const config = await getDeliveryChargeConfig();
    return res.json({
      success: true,
      ...config
    });
  } catch (error) {
    logger.error('Failed to load delivery charge config', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to load delivery charge configuration',
      error: error.message
    });
  }
};

exports.updateDeliveryChargeConfig = async (req, res) => {
  try {
    const validationError = validatePayload(req.body);
    if (validationError) {
      return res.status(400).json({
        success: false,
        message: validationError
      });
    }

    const config = await upsertDeliveryChargeConfig({
      options: req.body.options,
      defaultDeliveryType: req.body.defaultDeliveryType,
      updatedBy: req.user?.id
    });

    return res.json({
      success: true,
      message: 'Delivery charge configuration updated successfully',
      ...config
    });
  } catch (error) {
    logger.error('Failed to update delivery charge config', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update delivery charge configuration',
      error: error.message
    });
  }
};
