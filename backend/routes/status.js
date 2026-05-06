'use strict';
const router = require('express').Router();
const { getStatus: getBinlogStatus } = require('../src/binlog');
const { getStats }                   = require('../src/processor');
const { getConnectedCount }          = require('../src/websocket');
const config                         = require('../src/config');
const { query }                      = require('../src/db');

router.get('/', async (_req, res) => {
  const binlog = getBinlogStatus();
  const stats  = getStats();
  const cfg    = config.get();

  // DB query — retorna degradado en lugar de 500 si la BD no está disponible
  let counts = { pendiente: 0, ok: 0, error: 0, hoy: 0 };
  let dbStatus = 'error';

  try {
    const [rows] = await query(`
      SELECT
        SUM(sincronizado = 0) AS pendiente,
        SUM(sincronizado = 1) AS ok,
        SUM(sincronizado = 2) AS error,
        SUM(sincronizado = 1 AND DATE(fecha_sync) = CURDATE()) AS hoy
      FROM Cambios
    `);
    const r = rows[0] || {};
    counts = {
      pendiente: Number(r.pendiente || 0),
      ok:        Number(r.ok        || 0),
      error:     Number(r.error     || 0),
      hoy:       Number(r.hoy       || 0),
    };
    dbStatus = 'connected';
  } catch (dbErr) {
    console.error('[STATUS] DB error:', dbErr.message);
  }

  // Siempre devuelve 200 (el frontend detecta db:'error' y lo muestra)
  res.json({
    ok:  true,
    db:  dbStatus,
    worker: {
      paused:    cfg.paused,
      binlog:    binlog.connected ? 'connected' : 'disconnected',
      startedAt: binlog.startedAt,
      lastEvent: binlog.lastEventAt,
      wsClients: getConnectedCount(),
    },
    counts,
    runtime: stats,
  });
});

router.get('/schema/:table', async (req, res) => {
  try {
    const [rows] = await query(`SHOW COLUMNS FROM ${req.params.table}`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/debug-swagger', async (req, res) => {
  const https = require('https');
  https.get('https://apidev.ventaruta.net/docs/api-docs.json', (apiRes) => {
    let data = '';
    apiRes.on('data', chunk => data += chunk);
    apiRes.on('end', () => {
      try {
        const json = JSON.parse(data);
        const postProduct = json.paths['/api/v1/product']?.post;
        res.json(postProduct?.parameters || { error: 'Not found' });
      } catch(e) { res.json({ error: e.message }); }
    });
  }).on('error', err => res.json({ error: err.message }));
});

router.get('/debug-cambios', async (req, res) => {
  try {
    const [rows] = await query('SELECT * FROM Cambios ORDER BY id DESC LIMIT 20');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/debug-api-test', async (req, res) => {
  const axios = require('axios');
  const token = require('../src/config').get().psToken || process.env.PS_TOKEN;

  const payload = {
    data: [
      {
        SKU: "TEST-001",
        Name: "Test Product",
        BrandId: "BR-10",
        SubBrandId: "SBR-01",
        CategoryId: "CAT-04",
        SubCategoryId: "SCAT-02",
        LineId: "LIN-02",
        BranchId: "BRANCH-001"
      }
    ]
  };

  try {
    const apiRes = await axios.post('https://api.dev.powersales.cloud/api/grupoascencio/products', payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      }
    });
    res.json({ status: apiRes.status, data: apiRes.data });
  } catch (err) {
    res.json({ error: err.response?.data || err.message, status: err.response?.status });
  }
});

// Rutas de catálogo PowerSales
['brands','categories','lines','sub-brands','sub-categories'].forEach(entity => {
  router.get(`/ps-${entity}`, async (req, res) => {
    try {
      const { query: psQuery } = require('../src/db');
      const ps = require('../src/powersales');
      const r = await ps.get(`/${entity}`);
      res.json(r.data);
    } catch(err) {
      res.json({ error: err.response?.data || err.message, status: err.response?.status });
    }
  });
});

module.exports = router;
