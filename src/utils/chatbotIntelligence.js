/**
 * Enhanced Chatbot Intelligence Module
 * Provides intent detection, entity extraction, and multi-database query capabilities
 */

const Order = require('../models/Order')
const Product = require('../models/Product')
const DeliveryZone = require('../models/DeliveryZone')
const SupportTicket = require('../models/SupportTicket')

// Intent categories with associated keywords and synonyms
const INTENTS = {
  ORDER_STATUS: {
    keywords: ['order', 'track', 'tracking', 'status', 'delivery', 'shipped', 'where', 'when', 'arrive', 'eta', 'expected'],
    weight: 3,
    needsEntity: ['orderId', 'email']
  },
  PRODUCT_INFO: {
    keywords: ['product', 'item', 'price', 'cost', 'available', 'stock', 'size', 'color', 'material', 'fabric', 'details', 'specifications'],
    weight: 2.5,
    needsEntity: ['productName']
  },
  DELIVERY_ZONE: {
    keywords: ['deliver', 'delivery', 'ship', 'shipping', 'area', 'location', 'zone', 'available', 'pincode', 'address'],
    weight: 2,
    needsEntity: ['pincode', 'location']
  },
  PAYMENT: {
    keywords: ['payment', 'pay', 'paid', 'transaction', 'refund', 'money', 'charge', 'charged', 'amount', 'razorpay', 'upi', 'card'],
    weight: 2.5,
    needsEntity: ['orderId', 'transactionId']
  },
  RETURNS: {
    keywords: ['return', 'refund', 'cancel', 'exchange', 'replace', 'replacement', 'wrong', 'damaged', 'defective'],
    weight: 2.5,
    needsEntity: ['orderId']
  },
  TRIAL: {
    keywords: ['trial', 'try', 'fitting', 'test', 'trial order'],
    weight: 2,
    needsEntity: []
  },
  ACCOUNT: {
    keywords: ['account', 'login', 'password', 'register', 'signup', 'profile', 'email', 'phone'],
    weight: 1.5,
    needsEntity: ['email']
  },
  GENERAL: {
    keywords: ['help', 'support', 'contact', 'question', 'how', 'what', 'why', 'when'],
    weight: 1,
    needsEntity: []
  }
}

// Synonym mapping for better understanding
const SYNONYMS = {
  'order': ['purchase', 'bought', 'ordered', 'placed'],
  'track': ['trace', 'find', 'locate', 'check'],
  'delivery': ['shipping', 'deliver', 'ship', 'courier'],
  'status': ['state', 'condition', 'progress'],
  'cancel': ['stop', 'abort', 'terminate'],
  'refund': ['return money', 'get back', 'reimbursement'],
  'product': ['item', 'goods', 'merchandise'],
  'price': ['cost', 'rate', 'amount', 'charge'],
  'available': ['stock', 'in stock', 'availability'],
  'help': ['assist', 'support', 'aid']
}

// Entity extraction patterns
const ENTITY_PATTERNS = {
  orderId: /\b([A-Z0-9]{24}|ORD[A-Z0-9]{10,})\b/i,
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/,
  phone: /\b(\+91[\s-]?)?[6-9]\d{9}\b/,
  pincode: /\b\d{6}\b/,
  transactionId: /\b(pay_[A-Za-z0-9]+|order_[A-Za-z0-9]+)\b/i,
  price: /\b₹?\s?\d+(\.\d{2})?\b/,
  productName: null // Will be extracted through fuzzy matching
}

/**
 * Normalize and tokenize text
 */
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

/**
 * Expand query with synonyms
 */
function expandWithSynonyms(tokens) {
  const expanded = new Set(tokens)
  for (const token of tokens) {
    if (SYNONYMS[token]) {
      SYNONYMS[token].forEach(syn => {
        const synTokens = normalizeText(syn).split(' ')
        synTokens.forEach(t => expanded.add(t))
      })
    }
  }
  return Array.from(expanded)
}

/**
 * Detect user intent from message
 */
function detectIntent(message) {
  const tokens = tokenize(message)
  const expandedTokens = expandWithSynonyms(tokens)
  
  const tokenSet = new Set(expandedTokens)
  const intentScores = {}

  // Score each intent based on keyword matches
  for (const [intentName, intentData] of Object.entries(INTENTS)) {
    let score = 0
    for (const keyword of intentData.keywords) {
      const keywordTokens = tokenize(keyword)
      for (const kwToken of keywordTokens) {
        if (tokenSet.has(kwToken)) {
          score += intentData.weight
        }
      }
    }
    intentScores[intentName] = score
  }

  // Find top intent
  let topIntent = 'GENERAL'
  let maxScore = 0
  for (const [intent, score] of Object.entries(intentScores)) {
    if (score > maxScore) {
      maxScore = score
      topIntent = intent
    }
  }

  return {
    intent: topIntent,
    confidence: maxScore,
    allScores: intentScores
  }
}

/**
 * Extract entities from message
 */
function extractEntities(message) {
  const entities = {}

  for (const [entityType, pattern] of Object.entries(ENTITY_PATTERNS)) {
    if (!pattern) continue
    const match = message.match(pattern)
    if (match) {
      entities[entityType] = match[0]
    }
  }

  return entities
}

/**
 * Query order information from database
 */
async function queryOrderInfo(entities, userId = null) {
  try {
    const query = {}
    
    if (entities.orderId) {
      query._id = entities.orderId
    } else if (entities.email) {
      // Find user by email first
      const User = require('../models/User')
      const user = await User.findOne({ email: entities.email })
      if (user) {
        query.customer = user._id
      } else {
        return null
      }
    } else if (userId) {
      query.customer = userId
    } else {
      return null
    }

    const orders = await Order.find(query)
      .populate('items.product', 'name')
      .sort({ createdAt: -1 })
      .limit(5)
      .lean()

    if (!orders.length) return null

    // Format order information
    return orders.map(order => ({
      orderId: order._id,
      status: order.status,
      total: order.total,
      items: order.items.map(item => item.name).join(', '),
      deliveryETA: order.deliveryETA,
      paymentStatus: order.payment?.status,
      createdAt: order.createdAt,
      address: order.shippingAddress
    }))
  } catch (error) {
    console.error('Error querying order info:', error)
    return null
  }
}

/**
 * Query product information from database
 */
async function queryProductInfo(message, entities) {
  try {
    const tokens = tokenize(message)
    
    // Build search query
    const searchQuery = {
      $or: [
        { name: { $regex: tokens.join('|'), $options: 'i' } },
        { description: { $regex: tokens.join('|'), $options: 'i' } },
        { category: { $regex: tokens.join('|'), $options: 'i' } }
      ],
      status: 'Active'
    }

    const products = await Product.find(searchQuery)
      .select('name price originalPrice stock category images')
      .limit(5)
      .lean()

    if (!products.length) return null

    return products.map(product => ({
      name: product.name,
      price: product.price,
      originalPrice: product.originalPrice,
      inStock: product.stock > 0,
      category: product.category,
      image: product.images?.[0]
    }))
  } catch (error) {
    console.error('Error querying product info:', error)
    return null
  }
}

/**
 * Query delivery zone information
 */
async function queryDeliveryZone(entities, message) {
  try {
    if (entities.pincode) {
      // Search for zones that might cover this pincode
      // This is a simplified version - you might want more sophisticated geo-queries
      const zones = await DeliveryZone.find({ isActive: true })
        .select('name type minDeliveryFee deliveryTimeMinutes')
        .lean()

      return {
        available: zones.length > 0,
        zones: zones.map(z => ({
          name: z.name,
          deliveryFee: z.minDeliveryFee,
          estimatedTime: z.deliveryTimeMinutes
        }))
      }
    }

    // Return general delivery info
    const zones = await DeliveryZone.find({ isActive: true })
      .select('name')
      .lean()

    return {
      available: zones.length > 0,
      zoneNames: zones.map(z => z.name)
    }
  } catch (error) {
    console.error('Error querying delivery zones:', error)
    return null
  }
}

/**
 * Generate context-aware response based on intent and database data
 */
function generateEnhancedResponse(intent, dbData, faqMatch) {
  let response = {}

  switch (intent.intent) {
    case 'ORDER_STATUS':
      if (dbData && dbData.length > 0) {
        const order = dbData[0]
        response.reply = `Your order ${order.orderId.toString().substring(0, 8)}... is currently "${order.status}". `
        
        if (order.status === 'delivered') {
          response.reply += `It was delivered successfully.`
        } else if (order.status === 'shipped') {
          response.reply += `Expected delivery: ${order.deliveryETA}.`
        } else {
          response.reply += `We're processing your order and will update you soon.`
        }
        
        response.reply += `\n\nItems: ${order.items}\nTotal: ₹${order.total}`
        response.orderData = order
        response.shouldEscalate = false
      } else if (faqMatch) {
        response.reply = faqMatch.answer
        response.shouldEscalate = false
      } else {
        response.reply = 'I couldn\'t find your order. Please provide your Order ID or email address, and I\'ll help you track it.'
        response.shouldEscalate = true
      }
      break

    case 'PRODUCT_INFO':
      if (dbData && dbData.length > 0) {
        const products = dbData.slice(0, 3)
        response.reply = 'Here are the products I found:\n\n'
        products.forEach((p, i) => {
          response.reply += `${i + 1}. ${p.name}\n   Price: ₹${p.price}`
          if (p.originalPrice && p.originalPrice > p.price) {
            response.reply += ` (was ₹${p.originalPrice})`
          }
          response.reply += `\n   ${p.inStock ? '✓ In Stock' : '✗ Out of Stock'}\n\n`
        })
        response.productData = products
        response.shouldEscalate = false
      } else if (faqMatch) {
        response.reply = faqMatch.answer
        response.shouldEscalate = false
      } else {
        response.reply = 'I couldn\'t find specific products matching your query. Could you provide more details about what you\'re looking for?'
        response.shouldEscalate = true
      }
      break

    case 'DELIVERY_ZONE':
      if (dbData) {
        if (dbData.available) {
          response.reply = `Great news! We deliver to your area. `
          if (dbData.zones && dbData.zones.length > 0) {
            const zone = dbData.zones[0]
            response.reply += `Delivery fee starts at ₹${zone.deliveryFee} and typical delivery time is ${Math.round(zone.estimatedTime / 60)} hours.`
          } else if (dbData.zoneNames) {
            response.reply += `Available zones: ${dbData.zoneNames.join(', ')}`
          }
        } else {
          response.reply = 'Please provide your pincode to check if we deliver to your area.'
        }
        response.deliveryData = dbData
        response.shouldEscalate = false
      } else if (faqMatch) {
        response.reply = faqMatch.answer
        response.shouldEscalate = false
      } else {
        response.reply = 'To check delivery availability, please provide your pincode.'
        response.shouldEscalate = true
      }
      break

    case 'PAYMENT':
    case 'RETURNS':
      if (faqMatch) {
        response.reply = faqMatch.answer
        if (dbData && dbData.length > 0) {
          response.reply += `\n\nRegarding your order: ${dbData[0].orderId.toString().substring(0, 8)}..., the payment status is "${dbData[0].paymentStatus}".`
          response.orderData = dbData[0]
        }
        response.shouldEscalate = false
      } else {
        response.reply = `For ${intent.intent === 'PAYMENT' ? 'payment' : 'return'} related queries, please provide your order ID so I can assist you better.`
        response.shouldEscalate = true
      }
      break

    default:
      if (faqMatch) {
        response.reply = faqMatch.answer
        response.shouldEscalate = false
      } else {
        response.reply = 'I\'m here to help! You can ask me about:\n• Order status and tracking\n• Product information and availability\n• Delivery areas and charges\n• Returns and refunds\n• Trial orders\n\nWhat would you like to know?'
        response.shouldEscalate = false
      }
  }

  return response
}

/**
 * Main intelligent query handler
 */
async function getIntelligentResponse(message, faqs, userId = null) {
  try {
    // Step 1: Detect intent
    const intentResult = detectIntent(message)
    
    // Step 2: Extract entities
    const entities = extractEntities(message)
    
    // Step 3: Query database based on intent
    let dbData = null
    
    switch (intentResult.intent) {
      case 'ORDER_STATUS':
      case 'PAYMENT':
      case 'RETURNS':
        dbData = await queryOrderInfo(entities, userId)
        break
      
      case 'PRODUCT_INFO':
        dbData = await queryProductInfo(message, entities)
        break
      
      case 'DELIVERY_ZONE':
        dbData = await queryDeliveryZone(entities, message)
        break
    }
    
    // Step 4: Find best FAQ match
    const normalizedMessage = normalizeText(message)
    const messageTokens = expandWithSynonyms(tokenize(message))
    
    let bestFaqMatch = null
    let bestFaqScore = 0
    
    for (const faq of faqs) {
      const questionText = `${faq.question} ${(faq.tags || []).join(' ')}`
      const faqTokens = expandWithSynonyms(tokenize(questionText))
      
      let score = 0
      const faqTokenSet = new Set(faqTokens)
      
      for (const token of messageTokens) {
        if (faqTokenSet.has(token)) {
          score += 2
        }
      }
      
      // Bonus for substring matches
      const normalizedQuestion = normalizeText(questionText)
      if (normalizedQuestion.includes(normalizedMessage) || normalizedMessage.includes(normalizedQuestion)) {
        score += 12
      }
      
      // Intent-based boosting
      const faqIntent = detectIntent(faq.question)
      if (faqIntent.intent === intentResult.intent) {
        score += 5
      }
      
      if (score > bestFaqScore) {
        bestFaqScore = score
        bestFaqMatch = faq
      }
    }
    
    // Step 5: Generate enhanced response
    const response = generateEnhancedResponse(
      intentResult,
      dbData,
      bestFaqScore >= 4 ? bestFaqMatch : null
    )
    
    // Add metadata
    response.intent = intentResult.intent
    response.confidence = intentResult.confidence
    response.entities = entities
    
    // Add FAQ match if found
    if (bestFaqMatch && bestFaqScore >= 4) {
      response.matchedFaq = {
        id: bestFaqMatch._id,
        question: bestFaqMatch.question,
        score: bestFaqScore
      }
      response.quickReplies = bestFaqMatch.quickReplies && bestFaqMatch.quickReplies.length 
        ? bestFaqMatch.quickReplies 
        : []
    }
    
    // Add suggested questions from similar FAQs
    if (!response.quickReplies || response.quickReplies.length === 0) {
      response.quickReplies = faqs
        .filter(f => detectIntent(f.question).intent === intentResult.intent)
        .slice(0, 4)
        .map(f => f.question)
    }
    
    return response
  } catch (error) {
    console.error('Error in intelligent response:', error)
    throw error
  }
}

module.exports = {
  detectIntent,
  extractEntities,
  getIntelligentResponse,
  normalizeText,
  tokenize
}
