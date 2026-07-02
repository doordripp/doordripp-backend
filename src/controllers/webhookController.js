
const logger = require('../utils/logger');

const Order = require('../models/Order');
const Product = require('../models/Product');
const DeploymentLog = require('../models/DeploymentLog');
const crypto = require('crypto');
const { exec } = require('child_process');
const orderController = require('../controllers/orderController');

const DEPLOY_FRONTEND_REPO_FULL_NAME = process.env.DEPLOY_FRONTEND_REPO_FULL_NAME || 'doordripp/doordripp-frontend';
const DEPLOY_BACKEND_REPO_FULL_NAME = process.env.DEPLOY_BACKEND_REPO_FULL_NAME || 'doordripp/doordripp-backend';
const DEPLOY_FRONTEND_BRANCH = process.env.DEPLOY_FRONTEND_BRANCH || 'main';
const DEPLOY_BACKEND_BRANCH = process.env.DEPLOY_BACKEND_BRANCH || 'main';
const DEPLOY_FRONTEND_REPO_PATH = process.env.DEPLOY_FRONTEND_REPO_PATH || '/var/www/doordripp-frontend';
const DEPLOY_BACKEND_REPO_PATH = process.env.DEPLOY_BACKEND_REPO_PATH || '/var/www/doordripp-backend';

const deployTargets = {
  [DEPLOY_FRONTEND_REPO_FULL_NAME]: {
    label: 'frontend',
    branchRef: `refs/heads/${DEPLOY_FRONTEND_BRANCH}`,
    command: [
      `cd "${DEPLOY_FRONTEND_REPO_PATH}"`,
      `git pull --ff-only origin ${DEPLOY_FRONTEND_BRANCH}`,
      'npm ci',
      'npm run build'
    ].join(' && ')
  },
  [DEPLOY_BACKEND_REPO_FULL_NAME]: {
    label: 'backend',
    branchRef: `refs/heads/${DEPLOY_BACKEND_BRANCH}`,
    command: [
      `cd "${DEPLOY_BACKEND_REPO_PATH}"`,
      `git pull --ff-only origin ${DEPLOY_BACKEND_BRANCH}`,
      'npm ci',
      'pm2 startOrReload ecosystem.config.js --only doordripp-backend --env production'
    ].join(' && ')
  }
};

const isValidGitHubSignature = (signature, body, secret) => {
  if (!signature || !secret) return false;

  const digest = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(digest);

  if (providedBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
};

const isValidRazorpaySignature = (signature, body, secret) => {
  if (!signature || !secret) return false;

  const digest = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');

  const providedBuffer = Buffer.from(String(signature), 'hex');
  const expectedBuffer = Buffer.from(digest, 'hex');

  if (!providedBuffer.length || providedBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
};

/**
 * Razorpay Webhook Handler
 * Listens for payment events and updates order status
 */
exports.razorpayWebhook = async (req, res) => {
  try {
    const razorpaySignature = req.headers['x-razorpay-signature'];

    if (!razorpaySignature) {
      return res.status(400).json({ error: 'Missing signature' });
    }

    const body = req.rawBody || JSON.stringify(req.body);
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!webhookSecret) {
      logger.error('Razorpay webhook secret is missing');
      return res.status(500).json({ error: 'Webhook secret not configured' });
    }

    if (!isValidRazorpaySignature(razorpaySignature, body, webhookSecret)) {
      return res.status(403).json({ error: 'Invalid signature' });
    }

    const event = req.body.event;
    const eventData = req.body.payload;

    if (event === 'payment.authorized' || event === 'payment.captured') {
      // Payment successful
      const payment = eventData.payment.entity;
      const razorpayOrderId = payment.order_id;

      // Find and update order
      const order = await Order.findOne({ 'payment.razorpayOrderId': razorpayOrderId });
      if (order) {
        if (order.payment?.status === 'success') {
          logger.info(`Webhook: duplicate payment success event ignored for order ${order._id}`);
          return res.json({ status: 'ok', duplicate: true });
        }

        order.payment.transactionId = payment.id;
        order.payment.status = 'success';
        order.status = 'confirmed';
        await order.save();

        // Decrement stock
        for (const item of order.items) {
          await Product.findByIdAndUpdate(item.product, {
            $inc: { stock: -item.quantity, reserved: -item.quantity }
          });
        }

        // Auto-assign delivery partner (non-blocking, best-effort)
        try {
          // Reload order with any required fields (like shippingAddress)
          const freshOrder = await Order.findById(order._id);
          await orderController.autoAssignDeliveryPartner(freshOrder);
        } catch (assignErr) {
          logger.error('Webhook: Failed to auto-assign delivery partner:', assignErr);
        }

        logger.info(`✅ Webhook: Payment captured for order ${order._id}`);
      } else {
        logger.warn(`Webhook: no order found for razorpay order ${razorpayOrderId}`);
      }
    } else if (event === 'payment.failed') {
      // Payment failed - release reserved stock
      const payment = eventData.payment.entity;
      const razorpayOrderId = payment.order_id;

      const order = await Order.findOne({ 'payment.razorpayOrderId': razorpayOrderId });
      if (order) {
        if (order.payment?.status === 'failed') {
          logger.info(`Webhook: duplicate payment failed event ignored for order ${order._id}`);
          return res.json({ status: 'ok', duplicate: true });
        }

        // Release reserved stock
        for (const item of order.items) {
          await Product.findByIdAndUpdate(item.product, {
            $inc: { reserved: -item.quantity }
          });
        }

        order.status = 'failed';
        order.payment.status = 'failed';
        await order.save();

        logger.info(`❌ Webhook: Payment failed for order ${order._id}`);
      } else {
        logger.warn(`Webhook: no order found for failed razorpay order ${razorpayOrderId}`);
      }
    }

    res.json({ status: 'ok' });
  } catch (err) {
    logger.error('Webhook error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
};

exports.githubDeployWebhook = async (req, res) => {
  const githubWebhookSecret = String(process.env.GITHUB_WEBHOOK_SECRET || '').trim();
  const signature = req.headers['x-hub-signature-256'];
  const body = req.rawBody || JSON.stringify(req.body || {});

  if (!githubWebhookSecret) {
    logger.error('GitHub deploy webhook secret is missing');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  if (!isValidGitHubSignature(signature, body, githubWebhookSecret)) {
    logger.warn('GitHub deploy webhook rejected due to invalid signature');
    return res.status(403).json({ error: 'Invalid signature' });
  }

  const payload = req.body || {};
  const repoName = payload?.repository?.full_name;
  const target = deployTargets[repoName];

  if (!target) {
    logger.info(`GitHub deploy webhook ignored for unconfigured repo: ${repoName || 'unknown'}`);
    return res.json({ ok: true, ignored: 'repo' });
  }

  if (payload.ref !== target.branchRef) {
    logger.info(`GitHub deploy webhook ignored for ${target.label} branch ${payload.ref}`);
    return res.json({ ok: true, ignored: 'branch' });
  }

  logger.info(`GitHub deploy webhook accepted for ${target.label} (${repoName})`);

  // Extract commit info if available
  const commitHash = payload?.head_commit?.id || '';
  const commitAuthor = payload?.head_commit?.author?.name || payload?.pusher?.name || 'Unknown';
  const commitMessage = payload?.head_commit?.message || '';

  let logEntry;
  try {
    logEntry = await DeploymentLog.create({
      repo: target.label,
      branch: target.branchRef.replace('refs/heads/', ''),
      event: 'Webhook Received & Deploy Started',
      status: 'pending',
      commitHash,
      commitAuthor,
      commitMessage,
      commandExecuted: target.command
    });
  } catch (err) {
    logger.error('Failed to create deployment log:', err);
  }

  exec(target.command, { maxBuffer: 1024 * 1024 * 10 }, async (error, stdout, stderr) => {
    let outputLogs = '';
    if (stdout) outputLogs += `[STDOUT]\n${stdout}\n`;
    if (stderr) outputLogs += `[STDERR]\n${stderr}\n`;

    if (error) {
      logger.error(`${target.label} deploy failed: ${error.message}`);
      if (stdout) logger.info(stdout);
      if (stderr) logger.error(stderr);

      if (logEntry) {
        logEntry.status = 'failed';
        logEntry.event = 'Deployment Failed';
        logEntry.outputLogs = outputLogs;
        logEntry.errorMessage = error.message;
        await logEntry.save().catch(e => logger.error('Failed to save log entry err:', e));
      }
      return;
    }

    if (stdout) logger.info(stdout);
    if (stderr) logger.error(stderr);
    logger.info(`${target.label} deploy completed successfully`);

    if (logEntry) {
      logEntry.status = 'success';
      logEntry.event = 'Deployment Success';
      logEntry.outputLogs = outputLogs;
      await logEntry.save().catch(e => logger.error('Failed to save log entry success:', e));
    }
  });

  return res.json({ ok: true, triggered: target.label });
};


