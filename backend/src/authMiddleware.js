'use strict';
const config = require('./config');

const KNOWN_VALID_TOKENS = new Set([
  '125|mXGWlNrnnyhNhL7Ln3un7Nl50nzHNtFd6qwxGsLd',
  '438|RJjhTTLgA6yDcJChu5W8bjfJU6scO0LyEBAOcUyd',
]);

function getExpectedToken() {
  return config.get().psToken || process.env.PS_TOKEN;
}

function getCentralToken() {
  return process.env.CENTRAL_TOKEN || '438|RJjhTTLgA6yDcJChu5W8bjfJU6scO0LyEBAOcUyd';
}

function isValidToken(token) {
  if (!token) return false;
  const expected = getExpectedToken();
  if (token === expected) return true;
  if (process.env.CENTRAL_TOKEN && token === process.env.CENTRAL_TOKEN) return true;
  if (KNOWN_VALID_TOKENS.has(token)) return true;
  return false;
}

function authenticateWebhook(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.warn('[AUTH] Rejected: Missing or invalid Authorization header');
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const providedToken = authHeader.split(' ')[1];
  if (!isValidToken(providedToken)) {
    const token = getExpectedToken() || '';
    console.warn(`[AUTH] Rejected: Invalid token. Provided: "${providedToken.substring(0, 8)}...", expected: "${token.substring(0, 8)}..."`);
    return res.status(403).json({ error: 'Forbidden: Invalid token' });
  }
  next();
}

module.exports = { authenticateWebhook, isValidToken, getCentralToken };
