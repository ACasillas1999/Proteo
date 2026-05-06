'use strict';
const router    = require('express').Router();
const config    = require('../src/config');
const { broadcast } = require('../src/websocket');

// POST /api/worker/pause
router.post('/pause', (_req, res) => {
  config.update({ paused: true });
  broadcast('worker_status', { paused: true, binlog: 'connected' });
  console.log('[WORKER] Pausado via API');
  res.json({ ok: true, paused: true });
});

// POST /api/worker/resume
router.post('/resume', (_req, res) => {
  config.update({ paused: false });
  broadcast('worker_status', { paused: false, binlog: 'connected' });
  console.log('[WORKER] Reanudado via API');
  res.json({ ok: true, paused: false });
});

module.exports = router;
