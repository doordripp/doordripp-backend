function isProdLikeEnvironment() {
  return process.env.NODE_ENV === 'production' || (process.env.BACKEND_URL || '').startsWith('https://');
}

function getAuthCookieOptions() {
  const secure = process.env.COOKIE_SECURE === 'true' || isProdLikeEnvironment();

  return {
    httpOnly: true,
    sameSite: secure ? 'none' : 'lax',
    secure,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    domain: process.env.COOKIE_DOMAIN || undefined,
  };
}

module.exports = {
  getAuthCookieOptions,
  isProdLikeEnvironment,
};