const bcrypt = require('bcryptjs')

const isBcryptHash = (value) => /^\$2[aby]\$\d{2}\$/.test(String(value || ''))

const hasUserSetPassword = (user) => {
  if (!user || !user.password) return false
  if (user.isPasswordSet) return true

  // Legacy local accounts predate the isPasswordSet flag but still have a real password.
  // OAuth-only accounts (Google/Apple) carry an internal random password, so keep those in set-password mode.
  return user.authProvider !== 'google' && user.authProvider !== 'apple'
}

const verifyPasswordAndUpgrade = async (user, candidatePassword) => {
  if (!user || !candidatePassword || !user.password) {
    return false
  }

  if (isBcryptHash(user.password)) {
    const matched = await bcrypt.compare(candidatePassword, user.password)
    if (matched && !user.isPasswordSet) {
      user.isPasswordSet = true
      await user.save()
    }
    return matched
  }

  // Some early flows stored plaintext because the model hook was disabled.
  // On the first successful check, save the raw password and let the model hash it.
  if (user.password === candidatePassword) {
    user.password = candidatePassword
    user.skipPasswordHash = false
    user.isPasswordSet = true
    await user.save()
    return true
  }

  return false
}

module.exports = {
  hasUserSetPassword,
  isBcryptHash,
  verifyPasswordAndUpgrade
}
