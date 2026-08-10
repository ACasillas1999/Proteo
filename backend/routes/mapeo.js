'use strict';
const router = require('express').Router();
const ps     = require('../src/powersales');
const {
  getFieldMapping, saveFieldMapping,
  getMappingForBranch, saveOverrideMapping,
  getConfig, setConfig,
} = require('../src/localdb');

// GET /api/mapeo — lee el mapeo actual desde proteo_db
router.get('/', async (_req, res) => {
  try {
    const fieldMap          = await getFieldMapping('articulo');
    const fieldMapAlm       = await getFieldMapping('articuloalm');
    const fieldMapCli       = await getFieldMapping('cliente');
    const fieldMapPedCab    = await getFieldMapping('pedido_cabecera');
    const fieldMapPedDet    = await getFieldMapping('pedido_detalle');
    const fieldMapCotCab    = await getFieldMapping('cotizacion_cabecera');
    const fieldMapCotDet    = await getFieldMapping('cotizacion_detalle');
    const categories        = await getConfig('articulo_categories', {
      MAT: 1, SERV: 2, NLAG: 3, HALB: 4,
      HAWA: 5, FERT: 6, VERP: 7, ROH: 8,
    });
    const defaultCategoryId = await getConfig('articulo_defaultCategoryId', 1);
    const pedidoCabeceraTable = await getConfig('pedido_cabecera_table', '');
    const pedidoDetalleTable  = await getConfig('pedido_detalle_table', '');
    const cotizacionCabeceraTable = await getConfig('cotizacion_cabecera_table', 'cbcot');
    const cotizacionDetalleTable  = await getConfig('cotizacion_detalle_table', 'dtcot');

    res.json({ 
      ok: true, 
      data: { 
        articulo: { fieldMap, categories, defaultCategoryId },
        articuloalm: { fieldMap: fieldMapAlm },
        cliente: { fieldMap: fieldMapCli },
        pedido_cabecera: { fieldMap: fieldMapPedCab, table: pedidoCabeceraTable },
        pedido_detalle: { fieldMap: fieldMapPedDet, table: pedidoDetalleTable },
        cotizacion_cabecera: { fieldMap: fieldMapCotCab, table: cotizacionCabeceraTable },
        cotizacion_detalle: { fieldMap: fieldMapCotDet, table: cotizacionDetalleTable },
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
    const incoming = req.body;
    const art    = incoming.articulo ?? {};
    const artAlm = incoming.articuloalm ?? {};
    const cli    = incoming.cliente ?? {};
    const pedCab = incoming.pedido_cabecera ?? {};
    const pedDet = incoming.pedido_detalle ?? {};
    const cotCab = incoming.cotizacion_cabecera ?? {};
    const cotDet = incoming.cotizacion_detalle ?? {};

    if (art.fieldMap)          await saveFieldMapping('articulo', art.fieldMap);
    if (art.categories)        await setConfig('articulo_categories', art.categories);
    if (art.defaultCategoryId) await setConfig('articulo_defaultCategoryId', art.defaultCategoryId);
    
    if (artAlm.fieldMap)       await saveFieldMapping('articuloalm', artAlm.fieldMap);
    if (cli.fieldMap)          await saveFieldMapping('cliente', cli.fieldMap);

    if (pedCab.fieldMap)              await saveFieldMapping('pedido_cabecera', pedCab.fieldMap);
    if (pedCab.table !== undefined)   await setConfig('pedido_cabecera_table', pedCab.table);
    if (pedDet.fieldMap)              await saveFieldMapping('pedido_detalle', pedDet.fieldMap);
    if (pedDet.table !== undefined)   await setConfig('pedido_detalle_table', pedDet.table);

    if (cotCab.fieldMap)              await saveFieldMapping('cotizacion_cabecera', cotCab.fieldMap);
    if (cotCab.table !== undefined)   await setConfig('cotizacion_cabecera_table', cotCab.table);
    if (cotDet.fieldMap)              await saveFieldMapping('cotizacion_detalle', cotDet.fieldMap);
    if (cotDet.table !== undefined)   await setConfig('cotizacion_detalle_table', cotDet.table);

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
  let dbConnected = true;
  try {
    const [rows] = await query('SHOW COLUMNS FROM articulo');
    erpColumns = rows.map(r => r.Field);
  } catch {
    dbConnected = false; /* DB no disponible */
  }

  res.json({ 
    ok: true, 
    psFields: PS_FIELDS, 
    erpColumns, 
    dbConnected,
    dbHost: process.env.MYSQL_HOST || 'localhost',
    dbName: process.env.MYSQL_DB || ''
  });
});

// GET /api/mapeo/fields/articuloalm — devuelve campos PS y columnas ERP disponibles para inventario
router.get('/fields/articuloalm', async (_req, res) => {
  const { PS_FIELDS } = require('../src/handlers/articuloalm');
  const { query }     = require('../src/db');

  let erpColumns = [];
  let dbConnected = true;
  try {
    const [rows] = await query('SHOW COLUMNS FROM articuloalm');
    erpColumns = rows.map(r => r.Field);
  } catch {
    dbConnected = false; /* DB no disponible */
  }

  res.json({ ok: true, psFields: PS_FIELDS, erpColumns, dbConnected });
});

// GET /api/mapeo/fields/cliente — devuelve campos PS y columnas ERP disponibles para clientes
router.get('/fields/cliente', async (_req, res) => {
  const { PS_FIELDS } = require('../src/handlers/cliente');
  const { query }     = require('../src/db');

  let erpColumns = [];
  let dbConnected = true;
  try {
    const [rows] = await query('SHOW COLUMNS FROM clientes');
    erpColumns = rows.map(r => r.Field);
    if (!erpColumns.includes('e_mail')) {
      erpColumns.push('e_mail');
    }
  } catch {
    dbConnected = false; /* DB no disponible o tabla no existe aún */
  }

  res.json({ ok: true, psFields: PS_FIELDS, erpColumns, dbConnected });
});

// GET /api/mapeo/fields/pedido_cabecera — campos PS disponibles para cabecera de pedido
// (sin erpColumns — la tabla destino la elige el usuario, ver /tables y /columns/:table)
router.get('/fields/pedido_cabecera', async (_req, res) => {
  const { PS_FIELDS_CABECERA } = require('../src/handlers/pedido');
  res.json({ ok: true, psFields: PS_FIELDS_CABECERA });
});

// GET /api/mapeo/fields/pedido_detalle — campos PS disponibles para renglones de pedido
router.get('/fields/pedido_detalle', async (_req, res) => {
  const { PS_FIELDS_DETALLE } = require('../src/handlers/pedido');
  res.json({ ok: true, psFields: PS_FIELDS_DETALLE });
});

// GET /api/mapeo/fields/cotizacion_cabecera — campos PS disponibles para cabecera de cotización
router.get('/fields/cotizacion_cabecera', async (_req, res) => {
  const { PS_FIELDS_CABECERA } = require('../src/handlers/pedido');
  res.json({ ok: true, psFields: PS_FIELDS_CABECERA });
});

// GET /api/mapeo/fields/cotizacion_detalle — campos PS disponibles para renglones de cotización
router.get('/fields/cotizacion_detalle', async (_req, res) => {
  const { PS_FIELDS_DETALLE } = require('../src/handlers/pedido');
  res.json({ ok: true, psFields: PS_FIELDS_DETALLE });
});

// GET /api/mapeo/tables — lista de tablas del ERP, para el selector de tabla de pedidos
router.get('/tables', async (_req, res) => {
  const { query } = require('../src/db');
  try {
    const [rows] = await query('SHOW TABLES');
    const tables = rows.map(r => Object.values(r)[0]);
    res.json({ ok: true, tables });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, tables: [] });
  }
});

// GET /api/mapeo/columns/:table — columnas de una tabla específica del ERP
// Valida el nombre contra SHOW TABLES antes de interpolar (evita inyección SQL).
router.get('/columns/:table', async (req, res) => {
  const { query } = require('../src/db');
  try {
    const [tableRows] = await query('SHOW TABLES');
    const validTables = tableRows.map(r => Object.values(r)[0]);
    if (!validTables.includes(req.params.table)) {
      return res.status(400).json({ ok: false, error: 'Tabla no existe en el ERP', columns: [] });
    }

    const [rows] = await query(`SHOW COLUMNS FROM \`${req.params.table}\``);
    const columns = rows.map(r => r.Field);
    res.json({ ok: true, columns });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, columns: [] });
  }
});

// GET /api/mapeo/branch/:branchId — sucursales jalan su mapeo merged (global + overrides)
router.get('/branch/:branchId', async (req, res) => {
  try {
    const branchId = parseInt(req.params.branchId);
    if (!branchId) return res.status(400).json({ error: 'branchId inválido' });

    const [articulo, articuloalm, cliente, pedido_cabecera, pedido_detalle, cotizacion_cabecera, cotizacion_detalle] = await Promise.all([
      getMappingForBranch('articulo',    branchId),
      getMappingForBranch('articuloalm', branchId),
      getMappingForBranch('cliente',     branchId),
      getMappingForBranch('pedido_cabecera', branchId),
      getMappingForBranch('pedido_detalle',  branchId),
      getMappingForBranch('cotizacion_cabecera', branchId),
      getMappingForBranch('cotizacion_detalle',  branchId),
    ]);
    const pedido_cabecera_table = await getConfig('pedido_cabecera_table', '');
    const pedido_detalle_table  = await getConfig('pedido_detalle_table', '');
    const cotizacion_cabecera_table = await getConfig('cotizacion_cabecera_table', 'cbcot');
    const cotizacion_detalle_table  = await getConfig('cotizacion_detalle_table', 'dtcot');
    res.json({
      ok: true,
      data: {
        articulo,
        articuloalm,
        cliente,
        pedido_cabecera,
        pedido_detalle,
        pedido_cabecera_table,
        pedido_detalle_table,
        cotizacion_cabecera,
        cotizacion_detalle,
        cotizacion_cabecera_table,
        cotizacion_detalle_table
      }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PUT /api/mapeo/branch/:branchId — guarda overrides de una sucursal específica
router.put('/branch/:branchId', async (req, res) => {
  try {
    const branchId = parseInt(req.params.branchId);
    if (!branchId) return res.status(400).json({ error: 'branchId inválido' });

    const { articulo, articuloalm, cliente } = req.body;
    if (articulo)    await saveOverrideMapping(branchId, 'articulo',    articulo);
    if (articuloalm) await saveOverrideMapping(branchId, 'articuloalm', articuloalm);
    if (cliente)     await saveOverrideMapping(branchId, 'cliente',     cliente);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
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
