'use strict';
const config = require('./config');

function getExpectedToken() {
  return config.get().psToken || process.env.PS_TOKEN;
}

function isValidToken(token) {
  return !!token && token === getExpectedToken();
}

function authenticateWebhook(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = getExpectedToken();

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.warn('[AUTH] Rejected: Missing or invalid Authorization header');
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const providedToken = authHeader.split(' ')[1];
  if (providedToken !== token) {
    console.warn(`[AUTH] Rejected: Invalid token. Provided: "${providedToken.substring(0, 8)}...", expected: "${token.substring(0, 8)}..."`);
    return res.status(403).json({ error: 'Forbidden: Invalid token' });
  }
  next();
}

module.exports = { authenticateWebhook, isValidToken };
