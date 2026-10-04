/**
 * Trial Room pricing. Server-side source of truth: the fee charged on a
 * Trial & Buy order is taken from here, never from the request body.
 */
const parsed = Number(process.env.TRIAL_FEE);

module.exports = {
  TRIAL_FEE: Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
};
