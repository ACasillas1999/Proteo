'use strict';
const router = require('express').Router();
const ps     = require('../src/powersales');
const {
  getFieldMapping, saveFieldMapping,
  getConfig, setConfig,
} = require('../src/localdb');

// GET /api/mapeo — lee el mapeo actual desde proteo_db
router.get('/', async (_req, res) => {
  try {
    const fieldMap          = await getFieldMapping('articulo');
    const fieldMapAlm       = await getFieldMapping('articuloalm');
    const categories        = await getConfig('articulo_categories', {
      MAT: 1, SERV: 2, NLAG: 3, HALB: 4,
      HAWA: 5, FERT: 6, VERP: 7, ROH: 8,
    });
    const defaultCategoryId = await getConfig('articulo_defaultCategoryId', 1);

    res.json({ 
      ok: true, 
      data: { 
        articulo: { fieldMap, categories, defaultCategoryId },
        articuloalm: { fieldMap: fieldMapAlm }
      } 
    });
  } catch (err) {
    console.error('[MAPEO GET] ERROR:', err);
    res.status(500).json({ ok: false, error: err.message, stack: err.stack });
  }
});

// PUT /api/mapeo — guarda el mapeo en proteo_db
router.put('/', async (req, res) => {
  try {
    const incoming = req.body;                        // { articulo: { fieldMap, categories, defaultCategoryId } }
    const art = incoming.articulo ?? {};
    const artAlm = incoming.articuloalm ?? {};

    if (art.fieldMap)          await saveFieldMapping('articulo', art.fieldMap);
    if (art.categories)        await setConfig('articulo_categories', art.categories);
    if (art.defaultCategoryId) await setConfig('articulo_defaultCategoryId', art.defaultCategoryId);
    
    if (artAlm.fieldMap)       await saveFieldMapping('articuloalm', artAlm.fieldMap);

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

  res.json({ ok: true, psFields: PS_FIELDS, erpColumns });
});

// GET /api/mapeo/fields/articuloalm — devuelve campos PS y columnas ERP disponibles para inventario
router.get('/fields/articuloalm', async (_req, res) => {
  const { PS_FIELDS } = require('../src/handlers/articuloalm');
  const { query }     = require('../src/db');

  let erpColumns = [];
  try {
    const [rows] = await query('SHOW COLUMNS FROM articuloalm');
    erpColumns = rows.map(r => r.Field);
  } catch { /* DB no disponible */ }

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
