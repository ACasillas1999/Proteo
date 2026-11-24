'use strict';
const router = require('express').Router();
const { upsertBranchStatus, getAllBranchStatuses } = require('../src/localdb');
const { broadcast } = require('../src/websocket');
const { authenticateWebhook } = require('../src/authMiddleware');

// POST /api/branches/heartbeat — cada sucursal reporta su estado
router.post('/heartbeat', authenticateWebhook, async (req, res) => {
  try {
    const { 
      branch_id, last_poll_id, erp_connected, version, hostname,
      sync_ok, sync_error, webhook_ok, webhook_error 
    } = req.body;
    if (!branch_id) return res.status(400).json({ error: 'branch_id required' });

    await upsertBranchStatus(branch_id, {
      lastPollId:        last_poll_id,
      erpConnected:      erp_connected,
      version,
      hostname,
      syncOkToday:       sync_ok || 0,
      syncErrorToday:    sync_error || 0,
      webhookOkToday:    webhook_ok || 0,
      webhookErrorToday: webhook_error || 0,
    });

    broadcast('branch_heartbeat', {
      branch_id,
      last_poll_id,
      erp_connected,
      hostname,
      sync_ok:       sync_ok || 0,
      sync_error:    sync_error || 0,
      webhook_ok:    webhook_ok || 0,
      webhook_error: webhook_error || 0,
      last_seen_at:  new Date().toISOString(),
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('[BRANCHES HEARTBEAT] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/branches/digest — estado + pendientes por sucursal (solo maestro)
router.get('/digest', async (_req, res) => {
  try {
    const { getAllBranchStatuses, localQuery } = require('../src/localdb');
    const statuses = await getAllBranchStatuses();
    const now = Date.now();

    const data = await Promise.all(statuses.map(async s => {
      const [rows] = await localQuery(
        'SELECT COUNT(*) as pending FROM webhook_logs WHERE (branch_id = ? OR branch_id IS NULL) AND id > ?',
        [s.branch_id, s.last_poll_id || 0]
      );
      const [pendingRows] = await localQuery(
        'SELECT id, entidad, clave_registro, datos, fecha_recepcion FROM webhook_logs WHERE (branch_id = ? OR branch_id IS NULL) AND id > ? ORDER BY id ASC LIMIT 50',
        [s.branch_id, s.last_poll_id || 0]
      );
      const pendingItems = pendingRows.map(r => {
        let d = null;
        try { d = typeof r.datos === 'string' ? JSON.parse(r.datos) : r.datos; } catch {}
        const folio = d?.OrderNumber || d?.SKU || d?.CustomerNumber || r.clave_registro;
        const statusId = d?.StatusId ?? d?.order?.StatusId ?? null;
        const statusName = d?.StatusName ?? d?.order?.StatusName ?? null;
        const total = d?.TotalAmount ?? d?.order?.TotalAmount ?? null;
        const customer = d?.CustomerId?.Name || d?.CustomerId?.CustomerNumber || null;
        return {
          id: r.id,
          entidad: r.entidad,
          clave: folio,
          statusId,
          statusName,
          total,
          customer,
          fecha_recepcion: r.fecha_recepcion,
        };
      });

      return {
        ...s,
        pending_count: rows[0].pending,
        pending_items: pendingItems,
        online: s.last_seen_at ? (now - new Date(s.last_seen_at).getTime()) < 2 * 60 * 1000 : false,
      };
    }));

    res.json({ ok: true, data });
  } catch (err) {
    console.error('[BRANCHES DIGEST] Error:', err);
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
