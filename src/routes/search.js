const router = require('express').Router();
const searchController = require('../controllers/searchController');

router.get('/', searchController.search);
router.get('/suggest', searchController.suggest);

module.exports = router;
