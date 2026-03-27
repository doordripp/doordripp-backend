const jwt = require('jsonwebtoken');
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

const hasAnyRole = (userRoles, allowedRoles = []) => {
  const normalizedUserRoles = normalizeRoles(userRoles);
  const normalizedAllowedRoles = normalizeRoles(allowedRoles);
  return normalizedAllowedRoles.some(role => normalizedUserRoles.includes(role));
};

exports.getPermissionsForRoles = getPermissionsForRoles;
exports.ROLE_PERMISSIONS = ROLE_PERMISSIONS;

exports.verifyToken = async (req, res, next) => {
  let token = null;
  
  // Check cookie first
  if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }
  // Fallback to Authorization header
  if (!token && req.headers.authorization) {
    const parts = req.headers.authorization.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') {
      token = parts[1];
    }
  }
  
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      logger.error('JWT_SECRET environment variable is not set');
      return res.status(500).json({ error: 'Server configuration error' });
    }
    
    const payload = jwt.verify(token, jwtSecret);
    const user = await User.findById(payload.id);
    if (!user) return res.status(401).json({ error: 'Invalid token user' });
    // Normalize user shape for downstream handlers
    req.user = {
      _id: user._id,
      id: user._id,
      roles: user.roles || [],
      name: user.name,
      email: user.email,
      phone: user.phone,
      permissions: payload.permissions || getPermissionsForRoles(user.roles || [])
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
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

