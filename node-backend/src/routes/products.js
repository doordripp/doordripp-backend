const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const { verifyToken, requireAdmin } = require('../middleware/auth');

router.get('/', productController.list);
router.get('/:id', productController.get);
router.post('/', verifyToken, requireAdmin, productController.create);
router.put('/:id', verifyToken, requireAdmin, productController.update);
router.delete('/:id', verifyToken, requireAdmin, productController.remove);

module.exports = router;
