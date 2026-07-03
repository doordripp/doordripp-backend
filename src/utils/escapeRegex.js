/**
 * Escapes a string so it can be safely used inside a RegExp constructor or $regex query,
 * preventing RegExp errors or ReDoS attacks.
 * @param {string} value - The input string to escape
 * @returns {string} - The escaped string
 */
const escapeRegex = (value = '') => {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

module.exports = escapeRegex;
