const Product = require('../models/Product');
const { buildSearchQuery } = require('../utils/searchUtils');
const config = require('../config/search');
const escapeRegex = require('../utils/escapeRegex');
const { getVisibilityFilter } = require('../utils/visibility');
const { attachSaleInfoToProducts } = require('../utils/promotionHelpers');
const { buildProductInventoryPayload } = require('../utils/productInventory');

class SearchService {
  async search(query, options = {}) {
    const {
      category,
      subcategory,
      sort,
      page = 1,
      limit = 20,
      isNewArrival,
      isBestSeller,
      isFeatured
    } = options;

    const skip = (page - 1) * limit;
    const queryContext = buildSearchQuery(query);
    const { normalizedQuery, tokens, stemmedTokens, expandedTokens, synonymsUsed, fuzzyPatterns, textSearchQuery } = queryContext;

    // Base filter
    const baseFilter = { ...getVisibilityFilter() };
    
    if (isNewArrival === 'true' || isNewArrival === true) baseFilter.isNewArrival = true;
    if (isBestSeller === 'true' || isBestSeller === true) baseFilter.isBestSeller = true;
    if (isFeatured === 'true' || isFeatured === true) baseFilter.isFeatured = true;
    
    if (subcategory) {
      baseFilter.subcategory = new RegExp(`^${escapeRegex(subcategory)}$`, 'i');
    }

    if (category && category !== 'All') {
      const catLower = category.toLowerCase();
      if (catLower === 'men') {
        baseFilter.category = { $regex: /^(men|both|unisex|both \(men & women\))$/i };
      } else if (catLower === 'women') {
        baseFilter.category = { $regex: /^(women|both|unisex|both \(men & women\))$/i };
      } else if (catLower === 'both' || catLower.includes('both')) {
        baseFilter.category = { $regex: /^(both|unisex|both \(men & women\))$/i };
      } else {
        baseFilter.category = new RegExp(`^${escapeRegex(category)}$`, 'i');
      }
    }

    if (!tokens.length) {
      // Fallback if no meaningful tokens
      const fallbackSearch = new RegExp(escapeRegex(query), 'i');
      baseFilter.$or = [
        { name: fallbackSearch },
        { description: fallbackSearch }
      ];
      
      const totalCount = await Product.countDocuments(baseFilter);
      let sortOption = { createdAt: -1 };
      if (sort === 'price-low') sortOption = { price: 1 };
      else if (sort === 'price-high') sortOption = { price: -1 };
      else if (sort === 'name') sortOption = { name: 1 };

      const products = await Product.find(baseFilter).sort(sortOption).skip(skip).limit(limit).lean();
      
      const formattedProducts = await this._formatProducts(products);
      
      return {
        data: formattedProducts,
        total: totalCount,
        page,
        totalPages: Math.ceil(totalCount / limit),
        searchMeta: { originalQuery: query, processedQuery: normalizedQuery, synonymsUsed: false, totalCandidates: products.length }
      };
    }

    // 1. Text Search Results (Primary)
    const textResults = await Product.find(
      { $text: { $search: textSearchQuery }, ...baseFilter },
      { _searchScore: { $meta: 'textScore' } }
    ).sort({ _searchScore: { $meta: 'textScore' } }).limit(100).lean();

    // Map _matchType to text
    textResults.forEach(r => r._matchType = 'text');

    // 2. Facet Results (Secondary)
    const escapedQuery = escapeRegex(normalizedQuery);
    const tokenOrConditions = expandedTokens.map(token => {
      const tokenRegex = new RegExp(escapeRegex(token), 'i');
      return {
        $or: [
          { name: tokenRegex },
          { category: tokenRegex },
          { subcategory: tokenRegex },
          { keyFeatures: tokenRegex },
          { searchTags: tokenRegex }
        ]
      };
    });

    const [facetResults] = await Product.aggregate([
      { $match: baseFilter },
      {
        $facet: {
          exactName: [
            { $match: { name: { $regex: new RegExp(`^${escapedQuery}$`, 'i') } } },
            { $addFields: { _matchType: 'exactName', _searchScore: 1 } },
            { $limit: 10 }
          ],
          prefixName: [
            { $match: { name: { $regex: new RegExp(`^${escapedQuery}`, 'i') } } },
            { $addFields: { _matchType: 'prefix', _searchScore: 1 } },
            { $limit: 20 }
          ],
          tokenMatch: [
            { $match: { $or: tokenOrConditions } },
            { $addFields: { _matchType: 'token', _searchScore: 1 } },
            { $limit: 50 }
          ]
        }
      }
    ]);

    let allCandidates = [
      ...textResults,
      ...facetResults.exactName,
      ...facetResults.prefixName,
      ...facetResults.tokenMatch
    ];

    // Fuzzy matching fallback
    if (allCandidates.length < 5 && normalizedQuery.length >= config.FUZZY_CONFIG.minQueryLength && fuzzyPatterns.length > 0) {
      const fuzzyRegexConditions = fuzzyPatterns.map(p => ({ name: { $regex: new RegExp(p, 'i') } }));
      const fuzzyResults = await Product.find({
        $or: fuzzyRegexConditions,
        ...baseFilter
      }).limit(20).lean();
      
      fuzzyResults.forEach(r => { r._matchType = 'fuzzy'; r._searchScore = 1; });
      allCandidates.push(...fuzzyResults);
    }

    // Synonym specific text search (if not already fully covered by expandedTokens in $text)
    // The previous textSearchQuery includes expanded tokens, so it might be sufficient.
    // However, as per requirements: If synonymsUsed is true, run synonym text search as another separate query.
    if (synonymsUsed && expandedTokens.length > tokens.length) {
       const synonymTextQuery = expandedTokens.filter(t => !stemmedTokens.includes(t)).join(' ');
       if (synonymTextQuery.trim().length > 0) {
           const synonymResults = await Product.find(
             { $text: { $search: synonymTextQuery }, ...baseFilter },
             { _searchScore: { $meta: 'textScore' } }
           ).limit(50).lean();
           synonymResults.forEach(r => { r._matchType = 'synonym'; });
           allCandidates.push(...synonymResults);
       }
    }

    // Deduplicate
    const seenIds = new Set();
    const uniqueCandidates = [];
    for (const cand of allCandidates) {
      const idStr = cand._id.toString();
      if (!seenIds.has(idStr)) {
        seenIds.add(idStr);
        uniqueCandidates.push(cand);
      } else {
        // If already seen, keep the higher score or better matchType
        const existing = uniqueCandidates.find(c => c._id.toString() === idStr);
        if (cand._matchType === 'exactName' || cand._matchType === 'prefix') {
           existing._matchType = cand._matchType;
        }
        if (cand._searchScore && existing._searchScore) {
           existing._searchScore = Math.max(cand._searchScore, existing._searchScore);
        }
      }
    }

    // Score candidates
    const scoredCandidates = this.scoreCandidates(uniqueCandidates, queryContext);

    // Apply sorting
    if (sort === 'price-low') {
      scoredCandidates.sort((a, b) => a.price - b.price);
    } else if (sort === 'price-high') {
      scoredCandidates.sort((a, b) => b.price - a.price);
    } else if (sort === 'name') {
      scoredCandidates.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      // Sort by relevance score
      scoredCandidates.sort((a, b) => b._relevanceScore - a._relevanceScore);
    }

    const totalCount = scoredCandidates.length;
    const paginatedCandidates = scoredCandidates.slice(skip, skip + limit);

    const formattedProducts = await this._formatProducts(paginatedCandidates);

    return {
      data: formattedProducts,
      total: totalCount,
      page,
      totalPages: Math.ceil(totalCount / limit),
      searchMeta: {
        originalQuery: query,
        processedQuery: normalizedQuery,
        synonymsUsed,
        totalCandidates: totalCount
      }
    };
  }

  scoreCandidates(candidates, queryContext) {
    const { SCORING_WEIGHTS } = config;
    return candidates.map(candidate => {
      let score = 0;

      // Text relevance score from MongoDB $text index (already weighted by field)
      if (candidate._searchScore) {
        score += candidate._searchScore * SCORING_WEIGHTS.textScoreMultiplier;
      }

      const nameLower = (candidate.name || '').toLowerCase();
      const queryLower = queryContext.normalizedQuery;

      // Name match bonuses (highest to lowest priority, only one applies)
      let nameMatched = false;
      if (nameLower === queryLower) {
        // Exact name match: product name IS the query
        score += SCORING_WEIGHTS.exactNameBonus;
        nameMatched = true;
      } else if (nameLower.startsWith(queryLower)) {
        // Prefix match: name starts with query
        score += SCORING_WEIGHTS.prefixNameBonus;
        nameMatched = true;
      } else {
        // Check if any query token matches a WHOLE WORD in the name
        // e.g. "bag" matches "Leather Bag" but not "Baghdad"
        const nameWords = nameLower.split(/[\s\-_\/]+/);
        const hasWordMatch = queryContext.tokens.some(t => nameWords.includes(t));
        if (hasWordMatch) {
          score += SCORING_WEIGHTS.nameWordMatchBonus;
          nameMatched = true;
        } else if (queryContext.tokens.some(t => nameLower.includes(t))) {
          // Substring match: query appears somewhere in name
          score += SCORING_WEIGHTS.nameContainsBonus;
          nameMatched = true;
        }
      }

      // Category/subcategory match bonuses
      const categoryLower = (candidate.category || '').toLowerCase();
      const subcategoryLower = (candidate.subcategory || '').toLowerCase();
      const categoryMatched = queryContext.tokens.some(t => categoryLower.includes(t));
      const subcategoryMatched = queryContext.tokens.some(t => subcategoryLower.includes(t));
      if (categoryMatched) score += SCORING_WEIGHTS.categoryBonus;
      if (subcategoryMatched) score += SCORING_WEIGHTS.subcategoryBonus;

      // Key features match
      const features = (candidate.keyFeatures || []).join(' ').toLowerCase();
      const featuresMatched = queryContext.tokens.some(t => features.includes(t));
      if (featuresMatched) score += SCORING_WEIGHTS.keyFeatureBonus;

      // Search tags match (explicit admin-curated tags)
      const tags = (candidate.searchTags || []).join(' ').toLowerCase();
      if (queryContext.tokens.some(t => tags.includes(t))) score += SCORING_WEIGHTS.nameContainsBonus;

      // Description-only penalty: if the match is ONLY in the description
      // and NOT in name, category, subcategory, or keyFeatures, heavily penalize
      // This prevents "gift bag included" in a perfume description from outranking actual bags
      if (!nameMatched && !categoryMatched && !subcategoryMatched && !featuresMatched) {
        score *= SCORING_WEIGHTS.descriptionOnlyPenalty;
      }

      // Popularity signals (applied AFTER relevance, as tiebreakers)
      if (candidate.isBestSeller) score += SCORING_WEIGHTS.bestSellerBoost;
      if (candidate.isFeatured) score += SCORING_WEIGHTS.featuredBoost;
      
      const rating = candidate.rating?.rating || 0;
      score += (rating / 5) * SCORING_WEIGHTS.ratingMultiplier;

      // Match type penalties
      if (candidate._matchType === 'fuzzy') score *= SCORING_WEIGHTS.fuzzyPenalty;
      if (candidate._matchType === 'synonym') score *= SCORING_WEIGHTS.synonymPenalty;

      candidate._relevanceScore = score;
      return candidate;
    });
  }

  async suggest(query, limit = config.AUTOCOMPLETE_CONFIG.maxSuggestions) {
    const queryContext = buildSearchQuery(query);
    if (queryContext.normalizedQuery.length < config.AUTOCOMPLETE_CONFIG.minQueryLength) {
      return [];
    }

    const escapedQuery = escapeRegex(queryContext.normalizedQuery);
    const filter = {
      name: { $regex: new RegExp(`^${escapedQuery}`, 'i') },
      ...getVisibilityFilter()
    };

    const products = await Product.find(filter).limit(limit).lean();
    
    const suggestions = products.map(product => ({
      text: product.name,
      type: 'product',
      productId: product._id,
      slug: product.slug,
      image: product.images?.[0] || null,
      category: product.category
    }));

    // Optionally extract categories
    const categories = [...new Set(products.map(p => p.category).filter(Boolean))];
    const categorySuggestions = categories.map(cat => ({
      text: cat,
      type: 'category'
    }));

    return [...categorySuggestions, ...suggestions].slice(0, limit);
  }

  async _formatProducts(products) {
    const enrichedProducts = await attachSaleInfoToProducts(products);
    return enrichedProducts.map(p => {
      const inventory = buildProductInventoryPayload(p);
      return {
        id: p._id,
        _id: p._id,
        name: p.name,
        slug: p.slug,
        description: p.description,
        price: p.price,
        originalPrice: p.originalPrice,
        discount: p.discount,
        stock: inventory.stock,
        category: p.category,
        subcategory: p.subcategory,
        images: p.images || [],
        image: p.images && p.images.length > 0 ? p.images[0] : null,
        colors: p.colors || [],
        sizes: inventory.sizes,
        sizeInventory: inventory.sizeInventory,
        availableSizes: inventory.availableSizes,
        defaultSize: inventory.defaultSize,
        inStock: inventory.inStock,
        rating: p.rating || { rating: 4.5, reviews: 0 },
        isNewArrival: p.isNewArrival || false,
        isBestSeller: p.isBestSeller || false,
        isFeatured: p.isFeatured || false,
        details: p.details || {},
        saleInfo: p.saleInfo || null
      };
    });
  }
}

module.exports = new SearchService();
