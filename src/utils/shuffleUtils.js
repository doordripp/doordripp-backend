/**
 * Backend utility for 6-Hour deterministic random shuffling, rank-distributed sampling,
 * and Subcategory Type Diversity across the entire database catalogue.
 */

// Mulberry32 PRNG
function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Convert string to 32-bit integer hash
function hashString(str = '') {
  let hash = 0
  const s = String(str)
  for (let i = 0; i < s.length; i++) {
    const char = s.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0
  }
  return Math.abs(hash)
}

/**
 * Returns current 6-hour time block index (updates at 00:00, 06:00, 12:00, 18:00 UTC).
 */
function get6HourSeed() {
  const SIX_HOURS_MS = 6 * 60 * 60 * 1000
  return Math.floor(Date.now() / SIX_HOURS_MS)
}

/**
 * Normalizes and categorizes a product into broad subcategory types
 * to enforce diversity across selected 8-item grids.
 */
function getProductType(product) {
  if (!product) return 'Other'
  const sub = (product.subcategory || '').toLowerCase().trim()
  const name = (product.name || '').toLowerCase()
  const cat = (product.category || '').toLowerCase().trim()

  if (sub.includes('perfume') || name.includes('perfume') || name.includes('eau de') || cat.includes('perfume')) return 'Perfumes'
  if (sub.includes('bag') || name.includes('bag') || name.includes('tote') || name.includes('handbag')) return 'Bags'
  if (sub.includes('earring') || name.includes('earring') || name.includes('earings')) return 'Earrings'
  if (sub.includes('ring') || name.includes('ring')) return 'Rings'
  if (sub.includes('bracelet') || name.includes('bracelet')) return 'Bracelets'
  if (sub.includes('necklace') || name.includes('necklace') || sub.includes('pendant') || name.includes('pendant')) return 'Necklaces'
  if (sub.includes('scarf') || name.includes('scarf') || name.includes('dupatta')) return 'Scarves'
  if (sub.includes('kurti') || name.includes('kurti') || sub.includes('ethnic') || name.includes('saree')) return 'Ethnic'
  if (sub.includes('footwear') || sub.includes('shoe') || name.includes('shoe') || name.includes('sneaker') || name.includes('heel') || cat.includes('footwear')) return 'Footwear'
  if (sub.includes('shirt') || sub.includes('t-shirt') || name.includes('shirt') || name.includes('t-shirt') || name.includes('top') || sub.includes('top')) return 'Tops & Shirts'
  if (sub.includes('jeans') || sub.includes('pant') || sub.includes('trouser') || sub.includes('short') || name.includes('jeans') || name.includes('pant')) return 'Bottoms'
  if (sub.includes('dress') || sub.includes('jacket') || sub.includes('coat') || sub.includes('hoodie') || sub.includes('sweater')) return 'Outerwear & Dresses'

  return sub || cat || 'Other'
}

/**
 * Shuffles an array deterministically using the 6-hour seed.
 */
function shuffleArray6Hour(array, salt = '') {
  if (!Array.isArray(array) || array.length <= 1) return [...(array || [])]

  const seed = get6HourSeed() + hashString(salt)
  const rng = mulberry32(seed)

  let indexed = array.map((item, originalIndex) => ({ item, originalIndex }))

  for (let i = indexed.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[indexed[i], indexed[j]] = [indexed[j], indexed[i]]
  }

  for (let i = 1; i < indexed.length; i++) {
    if (Math.abs(indexed[i].originalIndex - indexed[i - 1].originalIndex) <= 1) {
      let swapIndex = -1
      for (let k = 0; k < indexed.length; k++) {
        if (k === i || k === i - 1) continue
        const prevOk = k === 0 || Math.abs(indexed[i].originalIndex - indexed[k - 1].originalIndex) > 1
        const nextOk = k === indexed.length - 1 || Math.abs(indexed[i].originalIndex - indexed[k + 1].originalIndex) > 1
        const targetPrevOk = Math.abs(indexed[k].originalIndex - indexed[i - 1].originalIndex) > 1
        const targetNextOk = i === indexed.length - 1 || Math.abs(indexed[k].originalIndex - indexed[i + 1].originalIndex) > 1

        if (prevOk && nextOk && targetPrevOk && targetNextOk) {
          swapIndex = k
          break
        }
      }
      if (swapIndex !== -1) {
        ;[indexed[i], indexed[swapIndex]] = [indexed[swapIndex], indexed[i]]
      }
    }
  }

  return indexed.map(el => el.item)
}

/**
 * Picks `limit` (default 8) products from distinct rank tiers across full DB `array`
 * with strict subcategory type diversity (options.maxPerfumes, options.maxPerType).
 */
function pickShuffledDistributedProducts(array, limit = 8, salt = '', options = {}) {
  if (!Array.isArray(array) || array.length === 0) return []

  const maxPerfumes = options.maxPerfumes !== undefined ? options.maxPerfumes : 1
  const maxPerType = options.maxPerType || 2

  const targetCount = Math.min(limit, array.length)
  if (array.length <= targetCount) {
    return shuffleArray6Hour(array, salt)
  }

  const seed = get6HourSeed() + hashString(salt)
  const rng = mulberry32(seed)

  const indexedArray = array.map((item, originalIndex) => ({ item, originalIndex }))
  const bucketSize = indexedArray.length / targetCount
  const selected = []
  const typeCounts = {}

  for (let b = 0; b < targetCount; b++) {
    const startIndex = Math.floor(b * bucketSize)
    const endIndex = Math.min(indexedArray.length - 1, Math.floor((b + 1) * bucketSize) - 1)
    const candidates = indexedArray.slice(startIndex, endIndex + 1)

    if (candidates.length === 0) continue

    let bestCandidates = candidates.filter(c => {
      const type = getProductType(c.item)
      const currentCount = typeCounts[type] || 0
      const limitForType = type === 'Perfumes' ? maxPerfumes : maxPerType
      return currentCount < limitForType
    })

    if (bestCandidates.length === 0 && (typeCounts['Perfumes'] || 0) >= maxPerfumes) {
      bestCandidates = candidates.filter(c => getProductType(c.item) !== 'Perfumes')
    }

    if (bestCandidates.length === 0) {
      bestCandidates = candidates
    }

    const pickedIndex = Math.floor(rng() * bestCandidates.length)
    const chosen = bestCandidates[pickedIndex]

    const type = getProductType(chosen.item)
    typeCounts[type] = (typeCounts[type] || 0) + 1

    selected.push(chosen)
  }

  for (let i = selected.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[selected[i], selected[j]] = [selected[j], selected[i]]
  }

  for (let i = 1; i < selected.length; i++) {
    if (Math.abs(selected[i].originalIndex - selected[i - 1].originalIndex) <= 1) {
      const nextIdx = (i + 1) % selected.length
      ;[selected[i], selected[nextIdx]] = [selected[nextIdx], selected[i]]
    }
  }

  return selected.map(el => el.item)
}

/**
 * Pads section items up to `targetCount` (default 8) using full catalogue items
 * while enforcing subcategory diversity and 6-hour random shuffling.
 */
function getSectionProductsWithPadding(filteredItems = [], allItems = [], targetCount = 8, salt = '', options = {}) {
  let candidatePool = [...(filteredItems || [])]

  if (candidatePool.length < targetCount && Array.isArray(allItems) && allItems.length > 0) {
    const existingIds = new Set(candidatePool.map(p => String(p._id || p.id || p.slug)))
    const remainingCandidates = allItems.filter(p => !existingIds.has(String(p._id || p.id || p.slug)))

    const needed = targetCount - candidatePool.length
    const padded = pickShuffledDistributedProducts(remainingCandidates, needed, salt + '-pad', options)
    candidatePool = candidatePool.concat(padded)
  }

  return pickShuffledDistributedProducts(candidatePool, targetCount, salt, options)
}

module.exports = {
  getProductType,
  get6HourSeed,
  shuffleArray6Hour,
  shuffleArrayHourly: shuffleArray6Hour,
  pickShuffledDistributedProducts,
  getSectionProductsWithPadding
}
