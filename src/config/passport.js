const passport = require('passport')
const GoogleStrategy = require('passport-google-oauth20').Strategy
const User = require('../models/User')

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
// Default callback should point to backend route that handles the OAuth callback
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL || `${process.env.BACKEND_URL || 'http://localhost:4000'}/api/auth/google/callback`

if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        callbackURL: GOOGLE_CALLBACK_URL
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const email = profile.emails && profile.emails[0] && profile.emails[0].value
          if (!email) return done(new Error('No email found on Google profile'))

          // Find existing user by email
          let user = await User.findOne({ email })
          if (!user) {
            // create a new user with a random password (unused)
            const pwd = Math.random().toString(36).slice(-12)
            user = new User({ 
              name: profile.displayName || email.split('@')[0], 
              email, 
              password: pwd, 
              roles: [],
              emailVerified: true  // Google has already verified the email
            })
            await user.save()
          } else if (!user.emailVerified) {
            // If user exists but email wasn't verified, mark it as verified now
            user.emailVerified = true
            await user.save()
          }
          return done(null, user)
        } catch (err) {
          return done(err)
        }
      }
    )
  )
}

module.exports = passport
