const express = require('express');
const router = express.Router();
const supportController = require('../controllers/supportController');

router.get('/faqs', supportController.getFaqs);
router.post('/chat', supportController.handleChat);
router.post('/tickets', supportController.createTicket);

module.exports = router;
