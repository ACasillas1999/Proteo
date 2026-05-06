'use strict';
const router = require('express').Router();
const fs     = require('fs');
const path   = require('path');
const ps     = require('../src/powersales');

const MAPEO_FILE = path.join(__dirname, '..', 'mapeo.json');

// Mapeo por defecto
const DEFAULT_MAPEO = {
  articulo: {
    BrandId:    1,
    SubBrandId: 1,
    LineId:     1,
    BranchId:   1,
    categories: {
      MAT: 1, SERV: 2, NLAG: 3, HALB: 4,
      HAWA: 5, FERT: 6, VERP: 7, ROH: 8,
    },
    defaultCategoryId: 1,
  },
};

function readMapeo() {
  try {
    return JSON.parse(fs.readFileSync(MAPEO_FILE, 'utf-8'));
  } catch {
    return DEFAULT_MAPEO;
  }
}

function writeMapeo(data) {
  fs.writeFileSync(MAPEO_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// GET /api/mapeo — lee el mapeo actual
router.get('/', (_req, res) => {
  res.json({ ok: true, data: readMapeo() });
});

// PUT /api/mapeo — guarda el mapeo
router.put('/', (req, res) => {
  try {
    const incoming = req.body;
    writeMapeo(incoming);
    // Recarga el handler con nuevo mapeo
    res.json({ ok: true, data: incoming });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/mapeo/fields — devuelve campos PS y columnas ERP disponibles
router.get('/fields', async (_req, res) => {
  const { PS_FIELDS } = require('../src/handlers/articulo');
  const { query }     = require('../src/db');

  let erpColumns = [];
  try {
    const [rows] = await query('SHOW COLUMNS FROM articulo');
    erpColumns = rows.map(r => r.Field);
  } catch { /* DB no disponible */ }

  // PS_FIELDS es un array — lo pasamos directo
  res.json({ ok: true, psFields: PS_FIELDS, erpColumns });
});

// GET /api/mapeo/ps-catalogs — trae categorías, marcas, etc de PowerSales
router.get('/ps-catalogs', async (_req, res) => {
  const results = {};

  const endpoints = [
    { key: 'categories', url: '/categories' },
    { key: 'brands',     url: '/brands'     },
    { key: 'lines',      url: '/product-lines' },
    { key: 'subbrands',  url: '/sub-brands'  },
    { key: 'branches',   url: '/branches'    },
  ];

  for (const ep of endpoints) {
    try {
      const r = await ps.get(ep.url);
      results[ep.key] = r.data?.data ?? r.data;
    } catch {
      results[ep.key] = [];
    }
  }

  res.json({ ok: true, data: results });
});

module.exports = router;
