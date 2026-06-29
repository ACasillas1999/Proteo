'use strict';
const router = require('express').Router();
const { upsertBranchStatus, getAllBranchStatuses } = require('../src/localdb');
const { broadcast } = require('../src/websocket');

function authenticateWebhook(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = require('../src/config').get().psToken || process.env.PS_TOKEN;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  const providedToken = authHeader.split(' ')[1];
  if (providedToken !== token) {
    return res.status(403).json({ error: 'Forbidden: Invalid token' });
  }
  next();
}

// POST /api/branches/heartbeat — cada sucursal reporta su estado
router.post('/heartbeat', authenticateWebhook, async (req, res) => {
  try {
    const { branch_id, last_poll_id, erp_connected, version, hostname } = req.body;
    if (!branch_id) return res.status(400).json({ error: 'branch_id required' });

    await upsertBranchStatus(branch_id, {
      lastPollId:   last_poll_id,
      erpConnected: erp_connected,
      version,
      hostname,
    });

    broadcast('branch_heartbeat', {
      branch_id,
      last_poll_id,
      erp_connected,
      hostname,
      last_seen_at: new Date().toISOString(),
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('[BRANCHES HEARTBEAT] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/branches/status — dashboard del maestro consulta el estado de todas las sucursales
router.get('/status', async (_req, res) => {
  try {
    const rows = await getAllBranchStatuses();
    // Marcar online/offline: online si last_seen_at < 2 minutos
    const now = Date.now();
    const data = rows.map(r => ({
      ...r,
      online: r.last_seen_at ? (now - new Date(r.last_seen_at).getTime()) < 2 * 60 * 1000 : false,
    }));
    res.json({ ok: true, data });
  } catch (err) {
    console.error('[BRANCHES STATUS] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
