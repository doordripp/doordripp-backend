const express = require('express')
const router = express.Router()
const SupportFaq = require('../models/SupportFaq')
const SupportTicket = require('../models/SupportTicket')
const supportFaqSeed = require('../data/supportFaqSeed')
const { getIntelligentResponse, normalizeText } = require('../utils/chatbotIntelligence')

let seedChecked = false
let faqCache = {}
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

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
    const { message, language = 'en', questionId, userId } = req.body || {}
    const lang = String(language || 'en').toLowerCase()

    if (!message && !questionId) {
      return res.status(400).json({ error: 'Message or questionId is required' })
    }

    // Check response cache for message queries (only for simple FAQ lookups)
    if (message && !userId) {
      const normalizedMessage = normalizeText(message)
      const cached = getCachedResponse(lang, normalizedMessage)
      if (cached && !cached.requiresFreshData) {
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

    let response

    // Handle direct FAQ question ID lookup
    if (questionId) {
      const matched = faqs.find(faq => String(faq._id) === String(questionId)) || null
      
      if (matched) {
        response = {
          reply: matched.answer,
          matchedFaq: { id: matched._id, question: matched.question },
          quickReplies: matched.quickReplies && matched.quickReplies.length 
            ? matched.quickReplies 
            : faqs.slice(0, 4).map(faq => faq.question),
          shouldEscalate: false
        }
      } else {
        response = {
          reply: 'I could not find that question. Please select from the available options below.',
          shouldEscalate: true,
          quickReplies: faqs.slice(0, 5).map(faq => faq.question)
        }
      }
    } else if (message) {
      // Use intelligent response system for natural language queries
      response = await getIntelligentResponse(message, faqs, userId)
      
      // Mark if response contains dynamic data (shouldn't be cached long-term)
      if (response.orderData || response.productData || response.deliveryData) {
        response.requiresFreshData = true
      }
      
      // Add suggested questions if not enough quick replies
      if (!response.quickReplies || response.quickReplies.length < 3) {
        response.suggestedQuestions = faqs.slice(0, 5).map(faq => ({ 
          id: faq._id, 
          question: faq.question 
        }))
      }
    }

    // Cache response (with shorter TTL for dynamic data)
    if (message && !response.requiresFreshData) {
      const normalizedMessage = normalizeText(message)
      setCachedResponse(lang, normalizedMessage, response)
    }

    res.json(response)
  } catch (err) {
    console.error('Chat endpoint error:', err)
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
