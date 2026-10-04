const { verifyToken: verifyJwt, hashToken } = require('../config/auth');
const RevokedToken = require('../models/RevokedToken');
const User = require('../models/User');
const logger = require('../utils/logger');

const normalizeRoles = (roles = []) => {
  const roleArray = Array.isArray(roles) ? roles : [roles];
  const normalized = roleArray
    .filter(Boolean)
    .map(role => String(role).toLowerCase().trim());
  return Array.from(new Set(['customer', ...normalized]));
};

const ROLE_PERMISSIONS = {
  admin: [
    'manage_orders', 'assign_delivery', 'manage_customers', 
    'manage_delivery_partners', 'manage_delivery_schedules', 
    'view_reports', 'manage_managers', 'manage_roles', 'system_controls'
  ],
  manager: [
    'manage_orders', 'assign_delivery', 'manage_customers', 
    'manage_delivery_partners', 'manage_delivery_schedules', 
    'view_reports'
  ],
  delivery_partner: [
    'view_assigned_deliveries', 'update_delivery_status'
  ],
  customer: [
    'browse_products', 'place_orders', 'view_orders'
  ]
};

const getPermissionsForRoles = (roles = []) => {
  const perms = new Set();
  const normalizedRoles = normalizeRoles(roles);
  
  normalizedRoles.forEach(role => {
    if (ROLE_PERMISSIONS[role]) {
      ROLE_PERMISSIONS[role].forEach(p => perms.add(p));
    }
  });
  
  return Array.from(perms);
};

// Roles that gate access must be matched exactly. The implicit 'customer' role
// is only ever added to the USER side; adding it to the allowed side as well made
// every check pass for every authenticated user.
const normalizeAllowedRoles = (roles = []) => {
  const roleArray = Array.isArray(roles) ? roles : [roles];
  return Array.from(new Set(roleArray.filter(Boolean).map(role => String(role).toLowerCase().trim())));
};

const hasAnyRole = (userRoles, allowedRoles = []) => {
  const normalizedUserRoles = normalizeRoles(userRoles);
  const normalizedAllowedRoles = normalizeAllowedRoles(allowedRoles);
  return normalizedAllowedRoles.some(role => normalizedUserRoles.includes(role));
};

exports.getPermissionsForRoles = getPermissionsForRoles;
exports.ROLE_PERMISSIONS = ROLE_PERMISSIONS;

const extractToken = (req) => {
  if (req.cookies && req.cookies.token) return req.cookies.token;
  if (req.headers && req.headers.authorization) {
    const parts = req.headers.authorization.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') return parts[1];
  }
  return null;
};

class AuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

/**
 * Single place that turns a request into an authenticated user.
 * Rejects: bad signature / expired, single-purpose tokens, revoked tokens,
 * tokens from an older token version, deleted and banned accounts.
 */
const authenticateRequest = async (req, { allowDeleted = false } = {}) => {
  const token = extractToken(req);
  if (!token) throw new AuthError('No token provided');

  let payload;
  try {
    payload = verifyJwt(token);
  } catch (err) {
    if (err && (err.code === 'JWT_SECRET_MISSING' || err.code === 'JWT_SECRET_WEAK')) {
      logger.error('JWT secret is not usable; refusing to authenticate');
      throw new AuthError('Server configuration error', 500);
    }
    throw new AuthError('Invalid token');
  }

  // Reset / verification / download tokens share the signing key but are not sessions.
  if (!payload || !payload.id || payload.purpose) throw new AuthError('Invalid token');

  const user = await User.findById(payload.id);
  if (!user) throw new AuthError('Invalid token user');
  if (user.isDeleted && !allowDeleted) throw new AuthError('Invalid token user');
  if ((payload.tv || 0) !== (user.tokenVersion || 0)) {
    // Only the session that changed the password outlives that change.
    if (!user.keepTokenHash || user.keepTokenHash !== hashToken(token)) throw new AuthError('Session expired');
  }
  if (!user.isDeleted && (user.isBanned || user.blocked)) throw new AuthError('Account blocked');

  const revoked = await RevokedToken.exists({ tokenHash: hashToken(token) });
  if (revoked) throw new AuthError('Session expired');

  return { user, payload, token };
};

const toRequestUser = (user) => ({
  _id: user._id,
  id: user._id,
  roles: user.roles || [],
  name: user.name,
  email: user.email,
  phone: user.phone,
  // Always derived from the roles stored in the database, never from the token.
  permissions: getPermissionsForRoles(user.roles || [])
});

exports.extractToken = extractToken;
exports.authenticateRequest = authenticateRequest;
exports.AuthError = AuthError;

exports.verifyToken = async (req, res, next) => {
  try {
    const { user } = await authenticateRequest(req);
    req.user = toRequestUser(user);
    return next();
  } catch (err) {
    if (err instanceof AuthError) return res.status(err.status).json({ error: err.message });
    return next(err);
  }
};

exports.optionalVerifyToken = async (req, res, next) => {
  try {
    const { user } = await authenticateRequest(req);
    req.user = toRequestUser(user);
  } catch (err) {
    // Anonymous access is allowed on these routes.
  }
  return next();
};

exports.authorize = (permission) => {
  return (req, res, next) => {
    if (!req.user || !req.user.permissions) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    
    // Always allow admin super permissions or specific permission match
    if (req.user.permissions.includes('system_controls') || req.user.permissions.includes(permission)) {
      return next();
    }
    
    return res.status(403).json({ error: `Permission denied: Requires ${permission}` });
  };
};

exports.requireAdmin = (req, res, next) => {
  if (!req.user || !req.user.roles) {
    return res.status(403).json({ error: 'Admin required' });
  }
  const isAdmin = hasAnyRole(req.user.roles, ['admin']);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin required' });
  }
  next();
};

exports.requireAdminOrManager = (req, res, next) => {
  if (!req.user || !req.user.roles) {
    return res.status(403).json({ error: 'Admin or manager role required' });
  }

  const isAllowed = hasAnyRole(req.user.roles, ['admin', 'manager']);
  if (!isAllowed) {
    return res.status(403).json({ error: 'Admin or manager role required' });
  }

  next();
};

exports.requireAnyRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !req.user.roles) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    if (!hasAnyRole(req.user.roles, allowedRoles)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
};

exports.requireRole = (role) => {
  return (req, res, next) => {
    if (!req.user || !req.user.roles) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    if (!hasAnyRole(req.user.roles, [role])) {
      return res.status(403).json({ error: `${role} role required` });
    }

    next();
  };
};

exports.hasAnyRole = hasAnyRole;

