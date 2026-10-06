const express = require('express');
const router = express.Router();
const newsletterController = require('../controllers/newsletterController');
const { newsletterLimiter } = require('../middleware/rateLimiters');

// Subscribe to newsletter
router.post('/subscribe', newsletterLimiter, newsletterController.subscribe);

module.exports = router;