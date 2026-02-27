const express = require('express')
const router = express.Router()
const SupportFaq = require('../models/SupportFaq')
const SupportTicket = require('../models/SupportTicket')
const supportFaqSeed = require('../data/supportFaqSeed')

let seedChecked = false
let faqCache = {}
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes
const MAX_TOKEN_LENGTH = 20 // Pre-tokenized words are cached

async function ensureSeedFaqs() {
  if (seedChecked) return
  const existingCount = await SupportFaq.countDocuments()
  if (existingCount === 0) {
    await SupportFaq.insertMany(supportFaqSeed)
  }
  seedChecked = true
}

function getFromCache(language) {
  if (faqCache[language] && faqCache[language].expiry > Date.now()) {
    return faqCache[language].data
  }
  return null
}

function setCache(language, data) {
  faqCache[language] = {
    data,
    expiry: Date.now() + CACHE_TTL
  }
}

// Pre-compute token cache to avoid recalculation
const tokenCache = new Map()
const CACHE_SIZE = 1000

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenize(value) {
  // Check cache first
  if (tokenCache.has(value)) return tokenCache.get(value)
  
  const normalized = normalizeText(value)
  if (!normalized) {
    tokenCache.set(value, [])
    return []
  }
  
  const tokens = normalized.split(' ').filter(token => token.length > 1)
  
  // Simple cache eviction (clear when too large)
  if (tokenCache.size >= CACHE_SIZE) {
    tokenCache.clear()
  }
  
  tokenCache.set(value, tokens)
  return tokens
}

function scoreFaq(faq, messageTokens, normalizedMessage) {
  // Use pre-tokenized question with tags
  const questionText = `${faq.question} ${faq.tags.join(' ')}`
  const normalizedQuestion = normalizeText(questionText)
  if (!normalizedQuestion) return 0

  if (normalizedQuestion === normalizedMessage) return 100

  let score = 0
  
  // Create token set from FAQ
  const questionTokens = tokenize(questionText)
  const tokenSet = new Set(questionTokens)

  // Score matching tokens
  for (const token of messageTokens) {
    if (tokenSet.has(token)) {
      score += 2
    }
  }

  // Bonus for substring matches
  if (normalizedQuestion.includes(normalizedMessage) || normalizedMessage.includes(normalizedQuestion)) {
    score += 12
  }

  return score
}

router.get('/faqs', async (req, res, next) => {
  try {
    await ensureSeedFaqs()
    const language = (req.query.lang || 'en').toLowerCase()

    // Check cache first
    let cached = getFromCache(language)
    if (cached) {
      return res.json(cached)
    }

    let faqs = await SupportFaq.find({ language, isActive: true })
      .select('_id question answer category quickReplies tags')
      .lean()
    
    let fallbackUsed = false

    if (!faqs.length && language !== 'en') {
      faqs = await SupportFaq.find({ language: 'en', isActive: true })
        .select('_id question answer category quickReplies tags')
        .lean()
      fallbackUsed = true
    }

    const response = {
      language,
      fallbackUsed,
      faqs: faqs.map(faq => ({
        id: faq._id,
        question: faq.question,
        answer: faq.answer,
        category: faq.category,
        quickReplies: faq.quickReplies || []
      }))
    }

    // Cache the response
    setCache(language, response)
    res.json(response)
  } catch (err) {
    next(err)
  }
})

// Response cache for common queries
const responseCache = new Map()
const RESPONSE_CACHE_SIZE = 500

function getCachedResponse(language, normalizedMessage) {
  const key = `${language}:${normalizedMessage}`
  const cached = responseCache.get(key)
  if (cached && cached.expiry > Date.now()) {
    return cached.data
  }
  responseCache.delete(key)
  return null
}

function setCachedResponse(language, normalizedMessage, response) {
  const key = `${language}:${normalizedMessage}`
  
  // Simple cache eviction
  if (responseCache.size >= RESPONSE_CACHE_SIZE) {
    responseCache.delete(responseCache.keys().next().value)
  }
  
  responseCache.set(key, {
    data: response,
    expiry: Date.now() + CACHE_TTL
  })
}

router.post('/chat', async (req, res, next) => {
  try {
    await ensureSeedFaqs()
    const { message, language = 'en', questionId } = req.body || {}
    const lang = String(language || 'en').toLowerCase()

    if (!message && !questionId) {
      return res.status(400).json({ error: 'Message or questionId is required' })
    }

    // Check response cache for message queries
    if (message) {
      const normalizedMessage = normalizeText(message)
      const cached = getCachedResponse(lang, normalizedMessage)
      if (cached) {
        return res.json(cached)
      }
    }

    // Load FAQs from cache or database
    let faqs = getFromCache(lang)?.faqs
    
    if (!faqs) {
      faqs = await SupportFaq.find({ language: lang, isActive: true })
        .select('_id question answer category quickReplies tags')
        .lean()
      
      if (!faqs.length && lang !== 'en') {
        faqs = await SupportFaq.find({ language: 'en', isActive: true })
          .select('_id question answer category quickReplies tags')
          .lean()
      }
    }

    if (!faqs.length) {
      return res.json({
        reply: 'Support content is not available right now. Please use Contact Support below.',
        shouldEscalate: true,
        quickReplies: ['Contact support']
      })
    }

    let matched = null
    let bestScore = 0

    if (questionId) {
      matched = faqs.find(faq => String(faq._id) === String(questionId)) || null
      bestScore = matched ? 100 : 0
    }

    if (!matched && message) {
      const normalizedMessage = normalizeText(message)
      const messageTokens = tokenize(message)

      // Optimized matching: early exit if perfect match found
      for (let i = 0; i < faqs.length; i++) {
        const faq = faqs[i]
        const score = scoreFaq(faq, messageTokens, normalizedMessage)
        
        if (score > bestScore) {
          matched = faq
          bestScore = score
        }
        
        // Early exit on perfect match
        if (bestScore === 100) break
      }
    }

    let response
    if (!matched || bestScore < 4) {
      response = {
        reply: 'I could not find a perfect match. You can pick a question below or reach out to our support team.',
        shouldEscalate: true,
        quickReplies: faqs.slice(0, 5).map(faq => faq.question),
        suggestedQuestions: faqs.slice(0, 5).map(faq => ({ id: faq._id, question: faq.question }))
      }
    } else {
      response = {
        reply: matched.answer,
        matchedFaq: { id: matched._id, question: matched.question },
        quickReplies: matched.quickReplies && matched.quickReplies.length ? matched.quickReplies : faqs.slice(0, 4).map(faq => faq.question),
        shouldEscalate: false
      }
    }

    // Cache successful response
    if (message) {
      const normalizedMessage = normalizeText(message)
      setCachedResponse(lang, normalizedMessage, response)
    }

    res.json(response)
  } catch (err) {
    next(err)
  }
})

router.post('/tickets', async (req, res, next) => {
  try {
    const { name, email, orderId, message, language = 'en' } = req.body || {}

    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Name, email, and message are required' })
    }

    const ticket = new SupportTicket({
      name,
      email,
      orderId,
      message,
      language
    })

    await ticket.save()

    res.status(201).json({ ok: true, ticketId: ticket._id })
  } catch (err) {
    next(err)
  }
})

module.exports = router
