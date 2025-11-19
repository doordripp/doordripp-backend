const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { verifyToken } = require('../middleware/auth');

router.post('/', verifyToken, orderController.create);
router.get('/:id', verifyToken, orderController.get);

module.exports = router;
