const express = require('express')
const router = express.Router()
const SupportFaq = require('../models/SupportFaq')
const SupportTicket = require('../models/SupportTicket')
const supportFaqSeed = require('../data/supportFaqSeed')

let seedChecked = false

async function ensureSeedFaqs() {
  if (seedChecked) return
  const existingCount = await SupportFaq.countDocuments()
  if (existingCount === 0) {
    await SupportFaq.insertMany(supportFaqSeed)
  }
  seedChecked = true
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenize(value) {
  const normalized = normalizeText(value)
  if (!normalized) return []
  return normalized.split(' ').filter(token => token.length > 1)
}

function scoreFaq(faq, messageTokens, normalizedMessage) {
  const questionText = `${faq.question} ${faq.tags.join(' ')}`
  const normalizedQuestion = normalizeText(questionText)
  if (!normalizedQuestion) return 0

  if (normalizedQuestion === normalizedMessage) return 100

  let score = 0
  const questionTokens = tokenize(questionText)
  const tokenSet = new Set(questionTokens)

  messageTokens.forEach(token => {
    if (tokenSet.has(token)) score += 2
  })

  if (normalizedQuestion.includes(normalizedMessage) || normalizedMessage.includes(normalizedQuestion)) {
    score += 12
  }

  return score
}

router.get('/faqs', async (req, res, next) => {
  try {
    await ensureSeedFaqs()
    const language = (req.query.lang || 'en').toLowerCase()

    let faqs = await SupportFaq.find({ language, isActive: true }).sort({ category: 1, createdAt: 1 })
    let fallbackUsed = false

    if (!faqs.length && language !== 'en') {
      faqs = await SupportFaq.find({ language: 'en', isActive: true }).sort({ category: 1, createdAt: 1 })
      fallbackUsed = true
    }

    res.json({
      language,
      fallbackUsed,
      faqs: faqs.map(faq => ({
        id: faq._id,
        question: faq.question,
        answer: faq.answer,
        category: faq.category,
        quickReplies: faq.quickReplies || []
      }))
    })
  } catch (err) {
    next(err)
  }
})

router.post('/chat', async (req, res, next) => {
  try {
    await ensureSeedFaqs()
    const { message, language = 'en', questionId } = req.body || {}
    const lang = String(language || 'en').toLowerCase()

    if (!message && !questionId) {
      return res.status(400).json({ error: 'Message or questionId is required' })
    }

    let faqs = await SupportFaq.find({ language: lang, isActive: true })
    if (!faqs.length && lang !== 'en') {
      faqs = await SupportFaq.find({ language: 'en', isActive: true })
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

      faqs.forEach(faq => {
        const score = scoreFaq(faq, messageTokens, normalizedMessage)
        if (score > bestScore) {
          matched = faq
          bestScore = score
        }
      })
    }

    if (!matched || bestScore < 4) {
      return res.json({
        reply: 'I could not find a perfect match. You can pick a question below or reach out to our support team.',
        shouldEscalate: true,
        quickReplies: faqs.slice(0, 5).map(faq => faq.question),
        suggestedQuestions: faqs.slice(0, 5).map(faq => ({ id: faq._id, question: faq.question }))
      })
    }

    res.json({
      reply: matched.answer,
      matchedFaq: { id: matched._id, question: matched.question },
      quickReplies: matched.quickReplies && matched.quickReplies.length ? matched.quickReplies : faqs.slice(0, 4).map(faq => faq.question),
      shouldEscalate: false
    })
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
