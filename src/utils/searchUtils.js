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

function tokenizeQuery(query) {
  const normalized = normalizeQuery(query);
  if (!normalized) return [];
  return normalized
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

function buildSearchQuery(rawQuery) {
  const normalizedQuery = normalizeQuery(rawQuery);
  const tokens = tokenizeQuery(rawQuery);
  const stemmedTokens = stemTokens(tokens);
  
  const { expandedTokens, synonymsUsed } = expandSynonyms(stemmedTokens);
  
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
    textSearchQuery: expandedTokens.join(' ')
  };
}

module.exports = {
  normalizeQuery,
  tokenizeQuery,
  stemToken,
  stemTokens,
  expandSynonyms,
  generateFuzzyPattern,
  buildSearchQuery
};
