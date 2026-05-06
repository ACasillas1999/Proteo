'use strict';
const router = require('express').Router();
const config = require('../src/config');

// GET /api/config
router.get('/config', (_req, res) => {
  res.json({ ok: true, data: config.get() });
});

// PUT /api/config
router.put('/config', (req, res) => {
  const allowed = ['tablas_activas', 'max_retries', 'retry_backoff_ms'];
  const partial = {};

  for (const key of allowed) {
    if (req.body[key] !== undefined) partial[key] = req.body[key];
  }

  if (!Object.keys(partial).length) {
    return res.status(400).json({ ok: false, error: 'Sin campos válidos para actualizar' });
  }

  config.update(partial);
  res.json({ ok: true, data: config.get() });
});

module.exports = router;
