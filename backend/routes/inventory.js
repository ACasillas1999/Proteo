'use strict';
const router = require('express').Router();
const { authenticateWebhook } = require('../src/authMiddleware');
const branchSocket = require('../src/branchSocket');

const DEFAULT_TIMEOUT_MS = parseInt(process.env.INVENTORY_QUERY_TIMEOUT_MS) || 8000;

// GET /api/inventory?branch_id=9&ProductId=X&WarehouseId=Y&limit=200
router.get('/', authenticateWebhook, async (req, res) => {
  const branchId = parseInt(req.query.branch_id);
  if (!branchId || isNaN(branchId)) {
    return res.status(400).json({ ok: false, error: 'branch_id required' });
  }

  const { ProductId, WarehouseId, limit } = req.query;

  try {
    const data = await branchSocket.sendQuery(
      branchId,
      { ProductId, WarehouseId, limit },
      DEFAULT_TIMEOUT_MS
    );
    res.json({ ok: true, data });
  } catch (err) {
    if (err.code === 'branch_offline') {
      return res.status(503).json({ ok: false, error: 'branch_offline', branch_id: branchId });
    }
    if (err.code === 'timeout') {
      return res.status(504).json({ ok: false, error: 'timeout', branch_id: branchId });
    }
    // La sucursal contestó ok:false, o error inesperado
    res.status(502).json({ ok: false, error: err.message });
  }
});

module.exports = router;
