const express = require('express');
const router = express.Router();
const supportController = require('../controllers/supportController');
const { optionalVerifyToken } = require('../middleware/auth');
const { supportTicketLimiter } = require('../middleware/rateLimiters');

router.get('/faqs', supportController.getFaqs);
router.post('/chat', optionalVerifyToken, supportController.handleChat);
router.post('/tickets', supportTicketLimiter, supportController.createTicket);

module.exports = router;
