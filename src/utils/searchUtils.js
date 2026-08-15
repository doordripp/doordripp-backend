const { PorterStemmer } = require('natural');
const config = require('../config/search');
const escapeRegex = require('./escapeRegex');

function normalizeQuery(query) {
  if (!query) return '';
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Pre-process the normalized query to replace known multi-word synonym phrases
 * BEFORE tokenization. This handles cases like "t shirt" → "t-shirt",
 * "body spray" → "perfumes", etc. that would be broken by splitting on spaces.
 */
function applyMultiWordSynonyms(normalizedQuery) {
  let result = normalizedQuery;
  // Sort multi-word keys by length (longest first) to match greedily
  const multiWordKeys = Object.keys(config.SYNONYMS)
    .filter(k => k.includes(' '))
    .sort((a, b) => b.length - a.length);
  
  for (const phrase of multiWordKeys) {
    if (result.includes(phrase)) {
      // Replace the phrase with its canonical synonym
      result = result.replace(new RegExp(escapeRegex(phrase), 'g'), config.SYNONYMS[phrase]);
    }
  }
  return result;
}

function tokenizeQuery(query) {
  const normalized = normalizeQuery(query);
  if (!normalized) return [];

  // Apply multi-word synonyms BEFORE splitting into tokens
  const preprocessed = applyMultiWordSynonyms(normalized);

  return preprocessed
    .split(' ')
    .filter(token => token.length >= 2 && !config.STOP_WORDS.has(token));
}

function stemToken(token) {
  if (config.STEM_OVERRIDES[token]) {
    return config.STEM_OVERRIDES[token];
  }
  return PorterStemmer.stem(token);
}

function stemTokens(tokens) {
  const stemmed = tokens.map(stemToken);
  return [...new Set(stemmed)];
}

function expandSynonyms(tokens) {
  const expandedTokens = new Set(tokens);
  let synonymsUsed = false;

  for (const token of tokens) {
    // Check direct synonym match
    if (config.SYNONYMS[token]) {
      expandedTokens.add(config.SYNONYMS[token]);
      synonymsUsed = true;
    }
  }

  return {
    originalTokens: tokens,
    expandedTokens: [...expandedTokens],
    synonymsUsed
  };
}

function generateFuzzyPattern(token) {
  if (token.length < config.FUZZY_CONFIG.minQueryLength) return null;
  const prefix = token.substring(0, config.FUZZY_CONFIG.prefixLength);
  const rest = token.substring(config.FUZZY_CONFIG.prefixLength);
  
  if (rest.length === 0) return null;

  // Simple fuzzy pattern: prefix followed by the rest allowing 1 char substitution or omission
  let pattern = '^' + prefix + '(';
  pattern += rest + '|'; // Exact match
  
  for (let i = 0; i < rest.length; i++) {
    pattern += rest.substring(0, i) + '.' + rest.substring(i + 1) + '|'; // Substitution
    pattern += rest.substring(0, i) + rest.substring(i + 1) + '|'; // Deletion
    pattern += rest.substring(0, i) + '.' + rest.substring(i) + '|'; // Insertion
  }
  
  pattern = pattern.slice(0, -1) + ')$';
  return pattern;
}

/**
 * Build the MongoDB $text search query string.
 * Wraps hyphenated terms in quotes to force phrase matching
 * (prevents "t-shirt" from being tokenized as "t" + "shirt").
 */
function buildTextSearchString(expandedTokens) {
  return expandedTokens.map(token => {
    // If the token contains a hyphen, wrap in quotes for exact phrase matching
    if (token.includes('-')) {
      return `"${token}"`;
    }
    return token;
  }).join(' ');
}

function buildSearchQuery(rawQuery) {
  const normalizedQuery = normalizeQuery(rawQuery);
  const tokens = tokenizeQuery(rawQuery);
  const stemmedTokens = stemTokens(tokens);
  
  // Expand synonyms from BOTH original tokens and stemmed tokens
  // to catch cases where the original form maps to a synonym
  const allTokensForSynonyms = [...new Set([...stemmedTokens, ...tokens])];
  const { expandedTokens, synonymsUsed } = expandSynonyms(allTokensForSynonyms);
  
  const fuzzyPatterns = tokens
    .map(generateFuzzyPattern)
    .filter(Boolean);

  return {
    normalizedQuery,
    tokens,
    stemmedTokens,
    expandedTokens,
    synonymsUsed,
    fuzzyPatterns,
    textSearchQuery: buildTextSearchString(expandedTokens)
  };
}

module.exports = {
  normalizeQuery,
  tokenizeQuery,
  stemToken,
  stemTokens,
  expandSynonyms,
  generateFuzzyPattern,
  buildSearchQuery,
  applyMultiWordSynonyms,
  buildTextSearchString
};
