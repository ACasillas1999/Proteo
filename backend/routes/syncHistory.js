'use strict';
const router      = require('express').Router();
const { localQuery } = require('../src/localdb');

// GET /api/sync-history?page=&limit=&estado=&entidad=
router.get('/', async (req, res) => {
  try {
    const { estado, entidad, page = 1, limit = 50 } = req.query;

    let where  = 'WHERE 1=1';
    const params = [];

    if (entidad) {
      where += ' AND entidad = ?';
      params.push(entidad);
    }
    if (estado !== undefined && estado !== '') {
      where += ' AND estado = ?';
      params.push(parseInt(estado));
    }

    const limitVal  = Math.max(1, parseInt(limit)  || 50);
    const offsetVal = Math.max(0, (Math.max(1, parseInt(page)) - 1) * limitVal);

    const [rows] = await localQuery(
      `SELECT * FROM sync_history ${where} ORDER BY fecha_sync DESC LIMIT ${limitVal} OFFSET ${offsetVal}`,
      params
    );
    const [[{ total }]] = await localQuery(
      `SELECT COUNT(*) AS total FROM sync_history ${where}`,
      params
    );

    res.json({ ok: true, data: rows, total: Number(total), page: parseInt(page), limit: limitVal });
  } catch (e) {
    console.error('[API:SYNC-HISTORY] Error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/sync-history/:id
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await localQuery('SELECT * FROM sync_history WHERE id = ? LIMIT 1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ ok: false, error: 'No encontrado' });
    res.json({ ok: true, data: rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
