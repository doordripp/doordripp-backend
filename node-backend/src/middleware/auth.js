const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');

exports.verifyToken = async (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'No token' });
  const parts = auth.split(' ');
  if (parts.length !== 2) return res.status(401).json({ error: 'Invalid token' });
  const token = parts[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    const user = await prisma.user.findUnique({ where: { id: payload.id } });
    if (!user) return res.status(401).json({ error: 'Invalid token user' });
    // roles stored as JSON in DB
    const roles = user.roles || [];
    req.user = { id: user.id, roles };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

exports.requireAdmin = (req, res, next) => {
  if (!req.user || !req.user.roles || !req.user.roles.includes('ADMIN')) return res.status(403).json({ error: 'Admin required' });
  next();
};
this is my test push
