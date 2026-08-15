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
    const isQueryShort = normalizedQuery.length <= 3;
    const tokenOrConditions = expandedTokens.map(token => {
      const isShort = token.length <= 3;
      const tokenRegex = isShort
        ? new RegExp(`(^|[^a-zA-Z0-9])${escapeRegex(token)}([^a-zA-Z0-9]|$)`, 'i')
        : new RegExp(escapeRegex(token), 'i');
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

    const prefixNameRegex = isQueryShort
      ? new RegExp(`^${escapedQuery}([^a-zA-Z0-9]|$)`, 'i')
      : new RegExp(`^${escapedQuery}`, 'i');

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
            { $match: { name: { $regex: prefixNameRegex } } },
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

    // Filter out candidates below the minimum relevance threshold
    // AND hard-exclude description-only matches (products where the query
    // only matched in the description field, not in name/category/subcategory/tags)
    const { minRelevanceThreshold } = config.SCORING_WEIGHTS;
    const relevantCandidates = scoredCandidates.filter(c => 
      c._relevanceScore >= minRelevanceThreshold && !c._descriptionOnly
    );

    // Apply sorting
    if (sort === 'price-low') {
      relevantCandidates.sort((a, b) => a.price - b.price);
    } else if (sort === 'price-high') {
      relevantCandidates.sort((a, b) => b.price - a.price);
    } else if (sort === 'name') {
      relevantCandidates.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      // Sort by relevance score
      relevantCandidates.sort((a, b) => b._relevanceScore - a._relevanceScore);
    }

    const totalCount = relevantCandidates.length;
    const paginatedCandidates = relevantCandidates.slice(skip, skip + limit);

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
      const nameWords = nameLower.split(/[\s\-_\/]+/);
      const isExactName = nameLower === queryLower;
      const matchedWholeWordTokens = queryContext.expandedTokens.filter(t => nameWords.includes(t));
      const startsWithExactWord = nameWords.length > 0 && queryContext.expandedTokens.includes(nameWords[0]);
      const startsWithQuery = nameLower.startsWith(queryLower);

      if (isExactName) {
        // 1. Exact name match: product name IS the query
        score += SCORING_WEIGHTS.exactNameBonus;
        nameMatched = true;
      } else if (matchedWholeWordTokens.length > 0) {
        // 2. Whole word match in name (e.g. "bra" matches "Sports Bra" or "Padded Bra")
        if (startsWithExactWord) {
          // Name starts with the exact whole query word (e.g. "Bra Top")
          score += SCORING_WEIGHTS.prefixNameBonus + 15;
        } else {
          // Name contains the whole query word anywhere
          score += SCORING_WEIGHTS.nameWordMatchBonus + 20;
        }
        nameMatched = true;
      } else if (startsWithQuery && queryLower.length > 3) {
        // 3. Prefix match for queries longer than 3 chars (e.g. "perfum" -> "perfume")
        score += SCORING_WEIGHTS.prefixNameBonus;
        nameMatched = true;
      } else {
        // 4. Substring match (only for query tokens > 3 chars to prevent short tokens like 'bra' matching 'bracelet')
        const validTokens = queryContext.expandedTokens.filter(t => t.length > 3);
        if (validTokens.some(t => nameLower.includes(t))) {
          score += SCORING_WEIGHTS.nameContainsBonus;
          nameMatched = true;
        }
      }

      // Category/subcategory match bonuses
      const categoryLower = (candidate.category || '').toLowerCase();
      const subcategoryLower = (candidate.subcategory || '').toLowerCase();

      // Exact subcategory match: check if any expanded token matches the subcategory exactly
      // (case-insensitive). e.g. "bags" expanded to ["bag", "bags"] should match subcategory "Bags"
      const subcategoryWords = subcategoryLower.split(/[\s\-_\/]+/);
      const subcategoryExactMatch = queryContext.expandedTokens.some(t => 
        subcategoryLower === t || subcategoryWords.includes(t)
      );
      const subcategoryMatched = subcategoryExactMatch || queryContext.expandedTokens.some(t => subcategoryLower.includes(t));
      
      // Category matching: check tokens against category field
      const categoryWords = categoryLower.split(/[\s\-_\/]+/);
      const categoryMatched = queryContext.expandedTokens.some(t => 
        categoryLower === t || categoryWords.includes(t) || categoryLower.includes(t)
      );

      if (subcategoryExactMatch) {
        score += SCORING_WEIGHTS.subcategoryExactBonus;
      } else if (subcategoryMatched) {
        score += SCORING_WEIGHTS.subcategoryBonus;
      }
      if (categoryMatched) score += SCORING_WEIGHTS.categoryBonus;

      // Key features match
      const features = (candidate.keyFeatures || []).join(' ').toLowerCase();
      const featuresMatched = queryContext.expandedTokens.some(t => features.includes(t));
      if (featuresMatched) score += SCORING_WEIGHTS.keyFeatureBonus;

      // Search tags match (explicit admin-curated tags) — dedicated weight
      const tags = (candidate.searchTags || []).join(' ').toLowerCase();
      const tagsMatched = queryContext.expandedTokens.some(t => tags.includes(t));
      if (tagsMatched) score += SCORING_WEIGHTS.searchTagsBonus;

      // Token coverage bonus: reward products that match MORE of the query tokens
      // For multi-word queries like "leather bag", a product matching both "leather" AND "bag"
      // should score much higher than one matching only "bag"
      if (queryContext.tokens.length > 1) {
        const allSearchableText = `${nameLower} ${categoryLower} ${subcategoryLower} ${features} ${tags}`;
        const matchedTokenCount = queryContext.tokens.filter(t => allSearchableText.includes(t)).length;
        const coverageRatio = matchedTokenCount / queryContext.tokens.length;
        score += coverageRatio * queryContext.tokens.length * SCORING_WEIGHTS.tokenCoverageMultiplier;
      }

      // Popularity signals — disabled for now to keep results strictly relevance-based
      // if (candidate.isBestSeller) score += SCORING_WEIGHTS.bestSellerBoost;
      // if (candidate.isFeatured) score += SCORING_WEIGHTS.featuredBoost;
      
      // const rating = candidate.rating?.rating || 0;
      // score += (rating / 5) * SCORING_WEIGHTS.ratingMultiplier;

      // STRICT: If the match is ONLY in the description and NOT in name, category,
      // subcategory, keyFeatures, or searchTags — hard exclude the product.
      // This prevents "gift bag included" in a perfume description from appearing
      // when searching "bags". No penalty — just exclusion.
      const hasPrimaryMatch = nameMatched || categoryMatched || subcategoryMatched || featuresMatched || tagsMatched;
      if (!hasPrimaryMatch) {
        candidate._descriptionOnly = true;
        score *= SCORING_WEIGHTS.descriptionOnlyPenalty;
      }

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
