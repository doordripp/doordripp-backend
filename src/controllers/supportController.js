const logger = require('../utils/logger')

const SupportFaq = require('../models/SupportFaq')
const SupportTicket = require('../models/SupportTicket')
const supportFaqSeed = require('../data/supportFaqSeed')
const { getIntelligentResponse, normalizeText } = require('../utils/chatbotIntelligence')
const mailService = require('../services/mail.service')

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

exports.getFaqs = async (req, res, next) => {
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
};

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

exports.handleChat = async (req, res, next) => {
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
      try {
        response = await getIntelligentResponse(message, faqs, userId)
      } catch (intelligenceError) {
        // Fallback to FAQ keyword matching so chat still works for common questions.
        const normalized = normalizeText(message)
        const matchedFaq = faqs.find((faq) => {
          const q = normalizeText(faq.question)
          return q.includes(normalized) || normalized.includes(q)
        }) || null

        if (matchedFaq) {
          response = {
            reply: matchedFaq.answer,
            matchedFaq: { id: matchedFaq._id, question: matchedFaq.question },
            quickReplies: matchedFaq.quickReplies && matchedFaq.quickReplies.length
              ? matchedFaq.quickReplies
              : faqs.slice(0, 4).map(faq => faq.question),
            shouldEscalate: false
          }
        } else {
          response = {
            reply: 'I can help with orders, returns, payments, and delivery. Please ask your question again or use Contact Support for human assistance.',
            quickReplies: faqs.slice(0, 5).map(faq => faq.question),
            shouldEscalate: true
          }
        }
      }
      
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
    logger.error('Chat endpoint error:', err)
    next(err)
  }
};

exports.createTicket = async (req, res, next) => {
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

    const supportEmail = process.env.SUPPORT_EMAIL || 'support@doordripp.com'
    const trimmedOrderId = String(orderId || '').trim()
    const subject = `New Support Ticket #${ticket._id.toString().slice(-8).toUpperCase()}`
    const safe = (value) => String(value || '').replace(/[<>]/g, '')
    const textBody = [
      `A new support ticket was submitted.`,
      ``,
      `Ticket ID: ${ticket._id}`,
      `Name: ${safe(name)}`,
      `Email: ${safe(email)}`,
      `Order ID: ${safe(trimmedOrderId) || 'N/A'}`,
      `Language: ${safe(language)}`,
      ``,
      `Message:`,
      `${safe(message)}`
    ].join('\n')

    const htmlBody = `
      <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111;">
        <h2 style="margin-bottom: 12px;">New Support Ticket</h2>
        <p><strong>Ticket ID:</strong> ${safe(ticket._id)}</p>
        <p><strong>Name:</strong> ${safe(name)}</p>
        <p><strong>Email:</strong> ${safe(email)}</p>
        <p><strong>Order ID:</strong> ${safe(trimmedOrderId) || 'N/A'}</p>
        <p><strong>Language:</strong> ${safe(language)}</p>
        <p><strong>Submitted At:</strong> ${new Date(ticket.createdAt).toLocaleString('en-IN')}</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;" />
        <p><strong>Message:</strong></p>
        <p style="white-space: pre-line;">${safe(message)}</p>
      </div>
    `

    await mailService.sendEmail({
      to: supportEmail,
      subject,
      html: htmlBody,
      text: textBody
    })

    res.status(201).json({ ok: true, ticketId: ticket._id })
  } catch (err) {
    next(err)
  }
};


