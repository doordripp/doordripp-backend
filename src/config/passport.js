const passport = require('passport')
const GoogleStrategy = require('passport-google-oauth20').Strategy
const User = require('../models/User')
const { uploadFromUrl } = require('../utils/imagekit-upload')
const logger = require('../utils/logger')
const crypto = require('crypto')

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
const GOOGLE_CLIENT_ID_DEV = process.env.GOOGLE_CLIENT_ID_DEV
const GOOGLE_CLIENT_SECRET_DEV = process.env.GOOGLE_CLIENT_SECRET_DEV

const normalizeBaseUrl = (url) => (url || '').trim().replace(/\/+$/, '')

const rawCallbackUrl = (process.env.GOOGLE_CALLBACK_URL || '').trim()
const rawDevCallbackUrl = (process.env.GOOGLE_CALLBACK_URL_DEV || '').trim()
const rawBackendUrl = normalizeBaseUrl(process.env.BACKEND_URL)
const isProd = process.env.NODE_ENV === 'production'

const fallbackBackendUrl = isProd ? 'https://doordripp.com' : 'http://localhost:4000'
const safeBackendUrl = rawBackendUrl || fallbackBackendUrl

// Callback URL determination
const GOOGLE_CALLBACK_URL = rawCallbackUrl || `${safeBackendUrl}/api/auth/google/callback`
const GOOGLE_CALLBACK_URL_DEV = rawDevCallbackUrl || `http://localhost:4000/login/oauth2/code/google-auth-dev`

if (isProd && GOOGLE_CALLBACK_URL.includes('localhost')) {
  logger.warn('Google OAuth callback URL still points to localhost in production. Check BACKEND_URL/GOOGLE_CALLBACK_URL env vars.')
}

logger.info(`Google OAuth callback URL configured: ${GOOGLE_CALLBACK_URL}`)

const googleStrategyVerify = async (accessToken, refreshToken, profile, done) => {
  try {
    logger.info('Google OAuth callback triggered');
    const email = profile.emails && profile.emails[0] && profile.emails[0].value
    if (!email) {
      logger.error('No email found on Google profile');
      return done(new Error('No email found on Google profile'));
    }

    // Normalize email to lowercase for case-insensitive matching
    const emailLower = email.toLowerCase().trim();

    // Extract all available profile data from Google
    const googleData = {
      name: profile.displayName || email.split('@')[0],
      email: emailLower,
      emailVerified: true, // Google has already verified the email
      googleId: profile.id
    }

    // Extract profile photo
    let avatarUrl = null
    if (profile.photos && profile.photos.length > 0) {
      const photoUrl = profile.photos[0].value
      logger.info(`Uploading Google profile photo to ImageKit...`)

      try {
        // Upload to ImageKit
        const uploadResult = await uploadFromUrl(
          photoUrl,
          `google_${profile.id}_${Date.now()}.jpg`,
          'avatars/google'
        )
        avatarUrl = uploadResult.url
        logger.info('Profile photo uploaded successfully.')
      } catch (err) {
        logger.error('Failed to upload profile photo:', err)
        // Fallback to original Google URL
        avatarUrl = photoUrl
      }
    }

    if (avatarUrl) {
      googleData.avatar = avatarUrl
    }

    // Find existing user by email (case-insensitive)
    let user = await User.findOne({ email: emailLower })

    if (!user) {
      // Create a new user with all available Google data
      const pwd = crypto.randomBytes(16).toString('hex') // Cryptographically secure random password

      user = new User({
        ...googleData,
        password: pwd,
        roles: [],
        termsAccepted: true // Auto-accept for OAuth users
      })

      await user.save()
      logger.info('New user created from Google OAuth.')
    } else {
      // Update existing user with Google data if not already set
      let updated = false

      if (!user.emailVerified) {
        user.emailVerified = true
        updated = true
      }

      // Update avatar if user doesn't have one or if new one from Google
      if (avatarUrl && (!user.avatar || user.avatar.includes('googleusercontent.com'))) {
        user.avatar = avatarUrl
        updated = true
      }

      // Update name if not set
      if (!user.name || user.name === email.split('@')[0]) {
        user.name = googleData.name
        updated = true
      }

      if (updated) {
        await user.save()
        logger.info('User updated from Google OAuth.')
      }
    }

    return done(null, user)
  } catch (err) {
    logger.error('Google OAuth error:', err)
    return done(err)
  }
}

if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        callbackURL: GOOGLE_CALLBACK_URL
      },
      googleStrategyVerify
    )
  )
}

if (GOOGLE_CLIENT_ID_DEV && GOOGLE_CLIENT_SECRET_DEV) {
  passport.use(
    'google-auth-dev',
    new GoogleStrategy(
      {
        clientID: GOOGLE_CLIENT_ID_DEV,
        clientSecret: GOOGLE_CLIENT_SECRET_DEV,
        callbackURL: GOOGLE_CALLBACK_URL_DEV
      },
      googleStrategyVerify
    )
  )
  logger.info(`Google OAuth DEV callback URL configured: ${GOOGLE_CALLBACK_URL_DEV}`)
}

module.exports = passport
