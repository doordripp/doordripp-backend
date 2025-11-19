const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');

const generateToken = (user) => {
  const payload = { id: user.id, roles: user.roles || [] };
  return jwt.sign(payload, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });
};

exports.register = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(400).json({ error: 'Email already in use' });
    const hashed = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({ data: { name, email, password: hashed, roles: [] } });
    const token = generateToken(user);
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, roles: user.roles } });
  } catch (err) {
    next(err);
  }
};

exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });
    if (user.blocked) return res.status(403).json({ error: 'Account blocked' });
    const token = generateToken(user);
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, roles: user.roles } });
  } catch (err) {
    next(err);
  }
};
