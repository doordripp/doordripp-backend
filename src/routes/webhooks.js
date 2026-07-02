const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');

router.post('/razorpay', webhookController.razorpayWebhook);
router.post('/github-deploy', webhookController.githubDeployWebhook);

module.exports = router;
