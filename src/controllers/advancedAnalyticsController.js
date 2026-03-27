/**
 * Analytics Controller
 * Exposes REST APIs for marketing, financial, and product analytics
 */

const analyticsService = require('../services/analyticsService');
const logger = require('../utils/logger');

/**
 * Parse date parameters from query
 */
const parseDateRange = (query) => {
  const { startDate, endDate, range = '30days' } = query;
  
  let start, end;
  const now = new Date();

  if (startDate && endDate) {
    start = new Date(startDate);
    end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
  } else {
    end = new Date(now);
    end.setHours(23, 59, 59, 999);

    switch (range) {
      case '7days':
        start = new Date(now);
        start.setDate(start.getDate() - 7);
        break;
      case '30days':
        start = new Date(now);
        start.setDate(start.getDate() - 30);
        break;
      case '90days':
        start = new Date(now);
        start.setDate(start.getDate() - 90);
        break;
      case 'year':
        start = new Date(now.getFullYear(), 0, 1);
        break;
      default:
        start = new Date(now);
        start.setDate(start.getDate() - 30);
    }
  }

  start.setHours(0, 0, 0, 0);
  return { startDate: start, endDate: end };
};

/**
 * ============================================
 * MARKETING ANALYTICS ENDPOINTS
 * ============================================
 */

/**
 * GET /api/analytics/customer-acquisition
 * Returns traffic source breakdown, CAC, conversion rate
 */
exports.getCustomerAcquisition = async (req, res, next) => {
  try {
    const { startDate, endDate } = parseDateRange(req.query);
    const data = await analyticsService.getCustomerAcquisition(startDate, endDate);
    res.json(data);
  } catch (error) {
    logger.error('Error fetching customer acquisition:', error);
    next(error);
  }
};

/**
 * GET /api/analytics/campaign-performance
 * Returns CTR, CPC, CPA, ROI per campaign
 */
exports.getCampaignPerformance = async (req, res, next) => {
  try {
    const { startDate, endDate } = parseDateRange(req.query);
    const data = await analyticsService.getCampaignPerformance(startDate, endDate);
    res.json(data);
  } catch (error) {
    logger.error('Error fetching campaign performance:', error);
    next(error);
  }
};

/**
 * GET /api/analytics/product-performance
 * Returns top selling, low performing, category-wise sales
 */
exports.getProductPerformance = async (req, res, next) => {
  try {
    const { startDate, endDate } = parseDateRange(req.query);
    const { limit = 20 } = req.query;
    const data = await analyticsService.getProductPerformance(
      startDate,
      endDate,
      parseInt(limit)
    );
    res.json(data);
  } catch (error) {
    logger.error('Error fetching product performance:', error);
    next(error);
  }
};

/**
 * GET /api/analytics/conversion-funnel
 * Returns visit → product view → add to cart → checkout → payment
 */
exports.getConversionFunnel = async (req, res, next) => {
  try {
    const { startDate, endDate } = parseDateRange(req.query);
    const data = await analyticsService.getConversionFunnel(startDate, endDate);
    res.json(data);
  } catch (error) {
    logger.error('Error fetching conversion funnel:', error);
    next(error);
  }
};

/**
 * ============================================
 * FINANCIAL ANALYTICS ENDPOINTS
 * ============================================
 */

/**
 * GET /api/analytics/revenue
 * Returns daily, monthly revenue, AOV
 */
exports.getRevenue = async (req, res, next) => {
  try {
    const { startDate, endDate } = parseDateRange(req.query);
    const { breakdown = 'daily' } = req.query;
    const data = await analyticsService.getRevenue(startDate, endDate, breakdown);
    res.json(data);
  } catch (error) {
    logger.error('Error fetching revenue:', error);
    next(error);
  }
};

/**
 * GET /api/analytics/profit-loss
 * Returns revenue, COGS, expenses, net profit
 */
exports.getProfitLoss = async (req, res, next) => {
  try {
    const { startDate, endDate } = parseDateRange(req.query);
    const data = await analyticsService.getProfitLoss(startDate, endDate);
    res.json(data);
  } catch (error) {
    logger.error('Error fetching profit & loss:', error);
    next(error);
  }
};

/**
 * GET /api/analytics/cash-flow
 * Returns inflow, outflow, net cash
 */
exports.getCashFlow = async (req, res, next) => {
  try {
    const { startDate, endDate } = parseDateRange(req.query);
    const { breakdown = 'monthly' } = req.query;
    const data = await analyticsService.getCashFlow(startDate, endDate, breakdown);
    res.json(data);
  } catch (error) {
    logger.error('Error fetching cash flow:', error);
    next(error);
  }
};

/**
 * GET /api/analytics/unit-economics
 * Returns CAC, LTV, profit per order
 */
exports.getUnitEconomics = async (req, res, next) => {
  try {
    const { startDate, endDate } = parseDateRange(req.query);
    const data = await analyticsService.getUnitEconomics(startDate, endDate);
    res.json(data);
  } catch (error) {
    logger.error('Error fetching unit economics:', error);
    next(error);
  }
};

/**
 * ============================================
 * COMPREHENSIVE REPORT
 * ============================================
 */

/**
 * GET /api/analytics/comprehensive-report
 * Returns all analytics data in one request
 */
exports.getComprehensiveReport = async (req, res, next) => {
  try {
    const { startDate, endDate } = parseDateRange(req.query);
    const data = await analyticsService.generateComprehensiveReport(startDate, endDate);
    res.json(data);
  } catch (error) {
    logger.error('Error generating comprehensive report:', error);
    next(error);
  }
};

/**
 * ============================================
 * DASHBOARD OVERVIEW
 * ============================================
 */

/**
 * GET /api/analytics/dashboard
 * Quick overview with key metrics
 */
exports.getDashboardMetrics = async (req, res, next) => {
  try {
    const { startDate, endDate } = parseDateRange(req.query);

    const [revenue, profitLoss, unitEconomics, customerAcquisition] = await Promise.all([
      analyticsService.getRevenue(startDate, endDate, 'daily'),
      analyticsService.getProfitLoss(startDate, endDate),
      analyticsService.getUnitEconomics(startDate, endDate),
      analyticsService.getCustomerAcquisition(startDate, endDate)
    ]);

    res.json({
      period: { startDate, endDate },
      kpis: {
        totalRevenue: revenue.totalRevenue,
        aov: revenue.aov,
        totalOrders: revenue.totalOrders,
        netProfit: profitLoss.netProfit,
        netMargin: profitLoss.netMargin,
        cac: unitEconomics.cac,
        ltv: unitEconomics.ltv,
        ltvToCAC: unitEconomics.ltcRatio,
        conversionRate: customerAcquisition.conversionRate
      },
      charts: {
        revenue: revenue.breakdown,
        profitMargin: profitLoss.netMargin
      }
    });
  } catch (error) {
    logger.error('Error fetching dashboard metrics:', error);
    next(error);
  }
};

module.exports = exports;
