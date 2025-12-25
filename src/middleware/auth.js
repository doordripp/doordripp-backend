const jwt = require('jsonwebtoken');
const User = require('../models/User');

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
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'secret');
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
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

exports.requireAdmin = (req, res, next) => {
  if (!req.user || !req.user.roles) {
    return res.status(403).json({ error: 'Admin required' });
  }
  const isAdmin = req.user.roles.some(r => r.toUpperCase() === 'ADMIN');
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin required' });
  }
  next();
};

