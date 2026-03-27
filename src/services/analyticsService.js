/**
 * Analytics Service Layer
 * Contains all business logic for calculating marketing, financial, and product analytics
 */

const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const Campaign = require('../models/Campaign');
const TrafficSource = require('../models/TrafficSource');
const Expense = require('../models/Expense');
const TrialOrder = require('../models/TrialOrder');
const logger = require('../utils/logger');

class AnalyticsService {
  /**
   * ======================
   * MARKETING ANALYTICS
   * ======================
   */

  /**
   * Get Customer Acquisition metrics
   * CAC: Customer Acquisition Cost = Total Marketing Spend / New Customers
   * Conversion Rate: Orders / Visitors
   */
  async getCustomerAcquisition(startDate, endDate) {
    try {
      const dateFilter = { createdAt: { $gte: startDate, $lte: endDate } };

      // Get unique visitors from traffic sources
      const visitors = await TrafficSource.find(dateFilter).distinct('user');
      const visitorCount = visitors.length;

      // Get new customers (who completed a purchase)
      const newCustomersWithOrders = await Order.find({
        customer: { $in: visitors },
        status: { $nin: ['cancelled', 'failed'] },
        ...dateFilter
      }).distinct('customer');
      const newCustomerCount = newCustomersWithOrders.length;

      // Get marketing spend (total expenses of type 'marketing')
      const marketingSpend = await Expense.aggregate([
        {
          $match: {
            type: 'marketing',
            status: 'paid',
            date: dateFilter.createdAt
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$amount' }
          }
        }
      ]);

      const totalMarketingSpend = marketingSpend[0]?.total || 0;

      // Calculate CAC
      const cac = newCustomerCount > 0 ? totalMarketingSpend / newCustomerCount : 0;

      // Calculate conversion rate
      const conversionRate = visitorCount > 0 ? (newCustomerCount / visitorCount) * 100 : 0;

      // Get traffic by source
      const trafficBySource = await TrafficSource.aggregate([
        {
          $match: dateFilter
        },
        {
          $group: {
            _id: '$source',
            count: { $sum: 1 },
            conversions: {
              $sum: { $cond: ['$actions.completed', 1, 0] }
            }
          }
        },
        {
          $sort: { count: -1 }
        }
      ]);

      return {
        visitorCount,
        newCustomerCount,
        totalMarketingSpend,
        cac: Math.round(cac * 100) / 100,
        conversionRate: Math.round(conversionRate * 100) / 100,
        trafficBySource: trafficBySource.map(item => ({
          source: item._id,
          visitors: item.count,
          conversions: item.conversions,
          conversionRate: Math.round((item.conversions / item.count) * 100 * 100) / 100
        }))
      };
    } catch (error) {
      logger.error('Error calculating customer acquisition:', error);
      throw error;
    }
  }

  /**
   * Get Campaign Performance metrics
   * CTR: Click Through Rate = Clicks / Impressions
   * CPC: Cost Per Click = Campaign Cost / Clicks
   * CPA: Cost Per Acquisition = Campaign Cost / Conversions
   * ROI: (Revenue - Cost) / Cost
   */
  async getCampaignPerformance(startDate, endDate) {
    try {
      const campaigns = await Campaign.find({
        startDate: { $gte: startDate },
        endDate: { $lte: endDate }
      }).lean();

      const campaignData = await Promise.all(
        campaigns.map(async (campaign) => {
          // Get orders attributed to this campaign
          const trafficData = await TrafficSource.find({
            campaign: campaign._id,
            createdAt: { $gte: startDate, $lte: endDate }
          });

          const customers = trafficData.map(t => t.user);
          const orders = await Order.find({
            customer: { $in: customers },
            createdAt: { $gte: startDate, $lte: endDate },
            status: { $nin: ['cancelled', 'failed'] }
          });

          const campaignRevenue = orders.reduce((sum, o) => sum + (o.total || 0), 0);
          const conversions = orders.length;
          const impressions = campaign.metrics.impressions || 0;
          const clicks = campaign.metrics.clicks || 0;

          return {
            campaignId: campaign._id,
            name: campaign.name,
            source: campaign.source,
            budget: campaign.budget,
            actualSpend: campaign.actualSpend,
            impressions,
            clicks,
            conversions,
            revenue: campaignRevenue,
            ctr: impressions > 0 ? Math.round((clicks / impressions) * 100 * 100) / 100 : 0,
            cpc: clicks > 0 ? Math.round((campaign.actualSpend / clicks) * 100) / 100 : 0,
            cpa: conversions > 0 ? Math.round((campaign.actualSpend / conversions) * 100) / 100 : 0,
            roi: campaign.actualSpend > 0
              ? Math.round(((campaignRevenue - campaign.actualSpend) / campaign.actualSpend) * 100)
              : 0,
            status: campaign.status
          };
        })
      );

      return campaignData.sort((a, b) => b.revenue - a.revenue);
    } catch (error) {
      logger.error('Error calculating campaign performance:', error);
      throw error;
    }
  }

  /**
   * Get Product Performance metrics
   * Top selling products, low performers, category-wise breakdown
   */
  async getProductPerformance(startDate, endDate, limit = 20) {
    try {
      const productPerformance = await Order.aggregate([
        {
          $match: {
            createdAt: { $gte: startDate, $lte: endDate },
            status: { $nin: ['cancelled', 'failed'] }
          }
        },
        {
          $unwind: '$items'
        },
        {
          $group: {
            _id: '$items.product',
            productName: { $first: '$items.name' },
            unitsSold: { $sum: '$items.quantity' },
            totalRevenue: {
              $sum: { $multiply: ['$items.price', '$items.quantity'] }
            },
            avgPrice: { $avg: '$items.price' },
            orders: { $sum: 1 }
          }
        },
        {
          $lookup: {
            from: 'products',
            localField: '_id',
            foreignField: '_id',
            as: 'productDetails'
          }
        },
        {
          $unwind: {
            path: '$productDetails',
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $sort: { totalRevenue: -1 }
        },
        {
          $limit: limit
        }
      ]);

      // Category-wise breakdown
      const categoryBreakdown = await Order.aggregate([
        {
          $match: {
            createdAt: { $gte: startDate, $lte: endDate },
            status: { $nin: ['cancelled', 'failed'] }
          }
        },
        {
          $unwind: '$items'
        },
        {
          $lookup: {
            from: 'products',
            localField: 'items.product',
            foreignField: '_id',
            as: 'product'
          }
        },
        {
          $unwind: {
            path: '$product',
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $group: {
            _id: '$product.category',
            categoryName: { $first: '$product.category' },
            unitsSold: { $sum: '$items.quantity' },
            totalRevenue: {
              $sum: { $multiply: ['$items.price', '$items.quantity'] }
            },
            averageOrderValue: { $avg: '$total' }
          }
        },
        {
          $sort: { totalRevenue: -1 }
        }
      ]);

      // Bottom performers
      const bottomPerformers = await Order.aggregate([
        {
          $match: {
            createdAt: { $gte: startDate, $lte: endDate }
          }
        },
        {
          $unwind: '$items'
        },
        {
          $group: {
            _id: '$items.product',
            productName: { $first: '$items.name' },
            unitsSold: { $sum: '$items.quantity' },
            totalRevenue: {
              $sum: { $multiply: ['$items.price', '$items.quantity'] }
            }
          }
        },
        {
          $sort: { unitsSold: 1 }
        },
        {
          $limit: 10
        }
      ]);

      return {
        topProducts: productPerformance.map(p => ({
          productId: p._id,
          name: p.productName,
          category: p.productDetails?.category || 'N/A',
          unitsSold: p.unitsSold,
          totalRevenue: Math.round(p.totalRevenue * 100) / 100,
          avgPrice: Math.round(p.avgPrice * 100) / 100,
          orders: p.orders
        })),
        categoryBreakdown: categoryBreakdown.map(c => ({
          category: c.categoryName || 'Uncategorized',
          unitsSold: c.unitsSold,
          totalRevenue: Math.round(c.totalRevenue * 100) / 100,
          averageOrderValue: Math.round(c.averageOrderValue * 100) / 100
        })),
        bottomPerformers: bottomPerformers.map(p => ({
          productId: p._id,
          name: p.productName,
          unitsSold: p.unitsSold,
          totalRevenue: Math.round(p.totalRevenue * 100) / 100
        }))
      };
    } catch (error) {
      logger.error('Error calculating product performance:', error);
      throw error;
    }
  }

  /**
   * Get Conversion Funnel metrics
   * Tracks: Visit → Product View → Add to Cart → Checkout → Payment
   */
  async getConversionFunnel(startDate, endDate) {
    try {
      const funnel = await TrafficSource.aggregate([
        {
          $match: {
            createdAt: { $gte: startDate, $lte: endDate }
          }
        },
        {
          $facet: {
            visits: [
              {
                $count: 'count'
              }
            ],
            productViews: [
              {
                $match: { 'actions.productViewed': true }
              },
              {
                $count: 'count'
              }
            ],
            addToCart: [
              {
                $match: { 'actions.addedToCart': true }
              },
              {
                $count: 'count'
              }
            ],
            checkout: [
              {
                $match: { 'actions.initiatedCheckout': true }
              },
              {
                $count: 'count'
              }
            ],
            completed: [
              {
                $match: { 'actions.completed': true }
              },
              {
                $count: 'count'
              }
            ]
          }
        }
      ]);

      const steps = [
        { name: 'Visits', count: funnel[0].visits[0]?.count || 0 },
        { name: 'Product Views', count: funnel[0].productViews[0]?.count || 0 },
        { name: 'Add to Cart', count: funnel[0].addToCart[0]?.count || 0 },
        { name: 'Checkout', count: funnel[0].checkout[0]?.count || 0 },
        { name: 'Completed', count: funnel[0].completed[0]?.count || 0 }
      ];

      // Calculate dropoff
      const funnelWithDropoff = steps.map((step, index) => {
        const prevCount = index === 0 ? steps[0].count : steps[index - 1].count;
        const dropoffRate =
          prevCount > 0 ? Math.round(((prevCount - step.count) / prevCount) * 100) : 0;
        return {
          ...step,
          dropoffRate
        };
      });

      return funnelWithDropoff;
    } catch (error) {
      logger.error('Error calculating conversion funnel:', error);
      throw error;
    }
  }

  /**
   * ======================
   * FINANCIAL ANALYTICS
   * ======================
   */

  /**
   * Get Revenue metrics
   * Daily, monthly revenue, AOV
   */
  async getRevenue(startDate, endDate, breakdownBy = 'daily') {
    try {
      const dateFormat =
        breakdownBy === 'daily'
          ? '%Y-%m-%d'
          : breakdownBy === 'monthly'
            ? '%Y-%m'
            : '%Y';

      const revenue = await Order.aggregate([
        {
          $match: {
            createdAt: { $gte: startDate, $lte: endDate },
            status: { $nin: ['cancelled', 'failed'] }
          }
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format: dateFormat,
                date: '$createdAt'
              }
            },
            totalRevenue: { $sum: '$total' },
            totalOrders: { $sum: 1 },
            avgOrderValue: { $avg: '$total' },
            totalGST: { $sum: '$totalGST' }
          }
        },
        {
          $sort: { _id: 1 }
        }
      ]);

      const totalRevenue = revenue.reduce((sum, r) => sum + r.totalRevenue, 0);
      const totalOrders = revenue.reduce((sum, r) => sum + r.totalOrders, 0);
      const aov = totalOrders > 0 ? totalRevenue / totalOrders : 0;

      return {
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        aov: Math.round(aov * 100) / 100,
        totalOrders,
        breakdown: revenue.map(r => ({
          period: r._id,
          revenue: Math.round(r.totalRevenue * 100) / 100,
          orders: r.totalOrders,
          aov: Math.round(r.avgOrderValue * 100) / 100,
          gst: Math.round(r.totalGST * 100) / 100
        }))
      };
    } catch (error) {
      logger.error('Error calculating revenue:', error);
      throw error;
    }
  }

  /**
   * Get Profit & Loss statement
   * Revenue - COGS - Marketing Expenses - Operational Expenses
   */
  async getProfitLoss(startDate, endDate) {
    try {
      // Get revenue
      const revenueData = await Order.aggregate([
        {
          $match: {
            createdAt: { $gte: startDate, $lte: endDate },
            status: { $nin: ['cancelled', 'failed'] }
          }
        },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: '$total' }
          }
        }
      ]);

      const totalRevenue = revenueData[0]?.totalRevenue || 0;

      // Calculate COGS (Cost of Goods Sold)
      const cogsData = await Order.aggregate([
        {
          $match: {
            createdAt: { $gte: startDate, $lte: endDate },
            status: { $nin: ['cancelled', 'failed'] }
          }
        },
        {
          $unwind: '$items'
        },
        {
          $lookup: {
            from: 'products',
            localField: 'items.product',
            foreignField: '_id',
            as: 'product'
          }
        },
        {
          $unwind: {
            path: '$product',
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $group: {
            _id: null,
            totalCogs: {
              $sum: {
                $multiply: [
                  { $ifNull: ['$product.costPrice', 0] },
                  '$items.quantity'
                ]
              }
            }
          }
        }
      ]);

      const totalCogs = cogsData[0]?.totalCogs || 0;
      const grossProfit = totalRevenue - totalCogs;

      // Get marketing expenses
      const marketingExpenses = await Expense.aggregate([
        {
          $match: {
            type: 'marketing',
            status: 'paid',
            date: { $gte: startDate, $lte: endDate }
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$amount' }
          }
        }
      ]);

      const totalMarketing = marketingExpenses[0]?.total || 0;

      // Get operational expenses
      const operationalExpenses = await Expense.aggregate([
        {
          $match: {
            type: { $in: ['operational', 'logistics', 'platform', 'personnel'] },
            status: 'paid',
            date: { $gte: startDate, $lte: endDate }
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$amount' }
          }
        }
      ]);

      const totalOperational = operationalExpenses[0]?.total || 0;
      const totalExpenses = totalMarketing + totalOperational;
      const netProfit = grossProfit - totalExpenses;

      return {
        revenue: Math.round(totalRevenue * 100) / 100,
        cogs: Math.round(totalCogs * 100) / 100,
        grossProfit: Math.round(grossProfit * 100) / 100,
        grossMargin: Math.round((grossProfit / totalRevenue) * 100),
        marketingExpenses: Math.round(totalMarketing * 100) / 100,
        operationalExpenses: Math.round(totalOperational * 100) / 100,
        totalExpenses: Math.round(totalExpenses * 100) / 100,
        netProfit: Math.round(netProfit * 100) / 100,
        netMargin: Math.round((netProfit / totalRevenue) * 100)
      };
    } catch (error) {
      logger.error('Error calculating profit & loss:', error);
      throw error;
    }
  }

  /**
   * Get Cash Flow analysis
   * Inflow - Outflow
   */
  async getCashFlow(startDate, endDate, breakdownBy = 'monthly') {
    try {
      const dateFormat = breakdownBy === 'daily' ? '%Y-%m-%d' : '%Y-%m';

      // Inflow: Revenue from orders
      const inflow = await Order.aggregate([
        {
          $match: {
            createdAt: { $gte: startDate, $lte: endDate },
            status: { $nin: ['cancelled', 'failed'] }
          }
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format: dateFormat,
                date: '$createdAt'
              }
            },
            inflow: { $sum: '$total' }
          }
        },
        {
          $sort: { _id: 1 }
        }
      ]);

      // Outflow: All paid expenses
      const outflow = await Expense.aggregate([
        {
          $match: {
            status: 'paid',
            date: { $gte: startDate, $lte: endDate }
          }
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format: dateFormat,
                date: '$date'
              }
            },
            outflow: { $sum: '$amount' }
          }
        },
        {
          $sort: { _id: 1 }
        }
      ]);

      // Merge inflow and outflow
      const flowMap = {};
      inflow.forEach(item => {
        flowMap[item._id] = { period: item._id, inflow: item.inflow, outflow: 0 };
      });
      outflow.forEach(item => {
        if (!flowMap[item._id]) {
          flowMap[item._id] = { period: item._id, inflow: 0, outflow: item.outflow };
        } else {
          flowMap[item._id].outflow = item.outflow;
        }
      });

      const cashFlow = Object.values(flowMap)
        .map(item => ({
          ...item,
          netCash: item.inflow - item.outflow
        }))
        .sort((a, b) => a.period.localeCompare(b.period));

      const totalInflow = inflow.reduce((sum, item) => sum + item.inflow, 0);
      const totalOutflow = outflow.reduce((sum, item) => sum + item.outflow, 0);
      const netCash = totalInflow - totalOutflow;

      return {
        totalInflow: Math.round(totalInflow * 100) / 100,
        totalOutflow: Math.round(totalOutflow * 100) / 100,
        netCash: Math.round(netCash * 100) / 100,
        breakdown: cashFlow.map(item => ({
          period: item.period,
          inflow: Math.round(item.inflow * 100) / 100,
          outflow: Math.round(item.outflow * 100) / 100,
          netCash: Math.round(item.netCash * 100) / 100
        }))
      };
    } catch (error) {
      logger.error('Error calculating cash flow:', error);
      throw error;
    }
  }

  /**
   * Get Unit Economics
   * CAC, LTV, Profit per order, customer lifetime value
   */
  async getUnitEconomics(startDate, endDate) {
    try {
      // Get new customers and their metrics
      const customerMetrics = await Order.aggregate([
        {
          $match: {
            createdAt: { $gte: startDate, $lte: endDate },
            status: { $nin: ['cancelled', 'failed'] }
          }
        },
        {
          $group: {
            _id: '$customer',
            totalSpent: { $sum: '$total' },
            orderCount: { $sum: 1 },
            avgOrderValue: { $avg: '$total' }
          }
        },
        {
          $group: {
            _id: null,
            totalCustomers: { $sum: 1 },
            totalRevenue: { $sum: '$totalSpent' },
            avgCustomerValue: { $avg: '$totalSpent' },
            avgOrdersPerCustomer: { $avg: '$orderCount' }
          }
        }
      ]);

      const metrics = customerMetrics[0] || {
        totalCustomers: 0,
        totalRevenue: 0,
        avgCustomerValue: 0,
        avgOrdersPerCustomer: 0
      };

      // Get marketing spend
      const marketingSpend = await Expense.aggregate([
        {
          $match: {
            type: 'marketing',
            status: 'paid',
            date: { $gte: startDate, $lte: endDate }
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$amount' }
          }
        }
      ]);

      const totalMarketing = marketingSpend[0]?.total || 0;

      // Get COGS
      const cogsData = await Order.aggregate([
        {
          $match: {
            createdAt: { $gte: startDate, $lte: endDate },
            status: { $nin: ['cancelled', 'failed'] }
          }
        },
        {
          $unwind: '$items'
        },
        {
          $lookup: {
            from: 'products',
            localField: 'items.product',
            foreignField: '_id',
            as: 'product'
          }
        },
        {
          $unwind: {
            path: '$product',
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $group: {
            _id: null,
            totalCogs: {
              $sum: {
                $multiply: [
                  { $ifNull: ['$product.costPrice', 0] },
                  '$items.quantity'
                ]
              }
            }
          }
        }
      ]);

      const totalCogs = cogsData[0]?.totalCogs || 0;

      // Calculate unit economics
      const cac = metrics.totalCustomers > 0
        ? Math.round((totalMarketing / metrics.totalCustomers) * 100) / 100
        : 0;

      const ltv =
        metrics.totalCustomers > 0
          ? Math.round((metrics.totalRevenue / metrics.totalCustomers) * 100) / 100
          : 0;

      const profitPerOrder = metrics.totalCustomers * metrics.avgOrdersPerCustomer > 0
        ? Math.round(
          ((metrics.totalRevenue - totalCogs) /
            (metrics.totalCustomers * metrics.avgOrdersPerCustomer)) *
          100
        ) / 100
        : 0;

      const ltcRatio = cac > 0 ? Math.round((ltv / cac) * 100) / 100 : 0;

      return {
        cac,
        ltv,
        profitPerOrder,
        ltcRatio,
        avgOrdersPerCustomer: Math.round(metrics.avgOrdersPerCustomer * 100) / 100,
        avgCustomerValue: Math.round(metrics.avgCustomerValue * 100) / 100,
        totalCustomers: metrics.totalCustomers,
        marketingSpend: Math.round(totalMarketing * 100) / 100
      };
    } catch (error) {
      logger.error('Error calculating unit economics:', error);
      throw error;
    }
  }

  /**
   * Generate comprehensive report with all metrics
   */
  async generateComprehensiveReport(startDate, endDate) {
    try {
      const [
        customerAcquisition,
        campaignPerformance,
        productPerformance,
        conversionFunnel,
        revenue,
        profitLoss,
        cashFlow,
        unitEconomics
      ] = await Promise.all([
        this.getCustomerAcquisition(startDate, endDate),
        this.getCampaignPerformance(startDate, endDate),
        this.getProductPerformance(startDate, endDate),
        this.getConversionFunnel(startDate, endDate),
        this.getRevenue(startDate, endDate),
        this.getProfitLoss(startDate, endDate),
        this.getCashFlow(startDate, endDate),
        this.getUnitEconomics(startDate, endDate)
      ]);

      return {
        period: {
          startDate,
          endDate
        },
        marketing: {
          customerAcquisition,
          campaignPerformance,
          conversionFunnel
        },
        products: productPerformance,
        financial: {
          revenue,
          profitLoss,
          cashFlow,
          unitEconomics
        }
      };
    } catch (error) {
      logger.error('Error generating comprehensive report:', error);
      throw error;
    }
  }
}

module.exports = new AnalyticsService();
