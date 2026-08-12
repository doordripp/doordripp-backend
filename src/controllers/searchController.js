const searchService = require('../services/searchService');

exports.search = async (req, res, next) => {
  try {
    const { 
      q, 
      category, 
      subcategory, 
      sort, 
      page = 1, 
      limit = 20, 
      isNewArrival, 
      isBestSeller, 
      isFeatured 
    } = req.query;

    if (!q || typeof q !== 'string') {
      return res.status(400).json({ error: 'Search query "q" is required and must be a string' });
    }

    const searchResults = await searchService.search(q, {
      category,
      subcategory,
      sort,
      page: parseInt(page),
      limit: parseInt(limit),
      isNewArrival,
      isBestSeller,
      isFeatured
    });

    res.json(searchResults);
  } catch (err) {
    next(err);
  }
};

exports.suggest = async (req, res, next) => {
  try {
    const { q } = req.query;
    
    if (!q || q.length < 2) {
      return res.json({ suggestions: [] });
    }

    const suggestions = await searchService.suggest(q);
    res.json({ suggestions });
  } catch (err) {
    next(err);
  }
};
