'use strict';
const router = require('express').Router();
const { saveWebhookLog: saveLogDb, localQuery } = require('../src/localdb');
const { broadcast } = require('../src/websocket');

async function saveWebhookLog(entidad, clave_registro, datos, estado, error_msg = null, branch_id = null) {
  try {
    await saveLogDb(entidad, clave_registro, datos, estado, error_msg, branch_id);
  } catch (dbErr) {
    console.error('[WEBHOOK LOG DB ERROR]', dbErr.message);
  }
  broadcast('webhook_received', {
    entidad,
    clave_registro,
    estado,
    error_msg,
    branch_id,
    fecha_recepcion: new Date().toISOString()
  });
}

function authenticateWebhook(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = require('../src/config').get().psToken || process.env.PS_TOKEN;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.warn('[WEBHOOK AUTH] Rejected: Missing or invalid Authorization header');
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const providedToken = authHeader.split(' ')[1];
  if (providedToken !== token) {
    console.warn(`[WEBHOOK AUTH] Rejected: Invalid token. Provided: "${providedToken.substring(0, 8)}...", expected: "${token.substring(0, 8)}..."`);
    return res.status(403).json({ error: 'Forbidden: Invalid token' });
  }
  next();
}

// GET /api/webhooks/logs — historial paginado
router.get('/logs', async (req, res) => {
  try {
    const page   = parseInt(req.query.page)  || 1;
    const limit  = parseInt(req.query.limit) || 25;
    const offset = (page - 1) * limit;

    let sqlWhere  = '1=1';
    const params      = [];
    const countParams = [];

    if (req.query.entidad) {
      sqlWhere += ' AND entidad = ?';
      params.push(req.query.entidad);
      countParams.push(req.query.entidad);
    }
    if (req.query.estado) {
      sqlWhere += ' AND estado = ?';
      params.push(parseInt(req.query.estado));
      countParams.push(parseInt(req.query.estado));
    }

    const [rows]      = await localQuery(`SELECT * FROM webhook_logs WHERE ${sqlWhere} ORDER BY fecha_recepcion DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
    const [countRows] = await localQuery(`SELECT COUNT(*) as total FROM webhook_logs WHERE ${sqlWhere}`, countParams);

    res.json({ ok: true, data: rows, total: countRows[0].total });
  } catch (err) {
    console.error('[WEBHOOKS API] Error fetching logs:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/webhooks/pending — sucursales jalan sus webhooks pendientes
router.get('/pending', authenticateWebhook, async (req, res) => {
  try {
    const branchId = parseInt(req.query.branch_id);
    const afterId  = parseInt(req.query.after_id) || 0;
    const limit    = Math.min(parseInt(req.query.limit) || 100, 500);

    if (!branchId) return res.status(400).json({ error: 'branch_id required' });

    const [rows] = await localQuery(
      `SELECT * FROM webhook_logs WHERE branch_id = ? AND id > ? ORDER BY id ASC LIMIT ?`,
      [branchId, afterId, limit]
    );
    res.json({ ok: true, data: rows, count: rows.length });
  } catch (err) {
    console.error('[WEBHOOKS PENDING] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/webhooks/powersales/object-update — recibe de PowerSales, guarda y distribuye
router.post('/powersales/object-update', authenticateWebhook, async (req, res) => {
  res.status(200).json({ ok: true, message: 'Webhook received' });

  try {
    const payload = req.body;

    broadcast('webhook_received', {
      object: payload.object || (payload.records ? 'batch' : 'unknown'),
      payload,
      fecha_recepcion: new Date().toISOString()
    });

    const records = payload.records ? payload.records : [payload];

    for (const record of records) {
      if (!record.object || !record.key || !record.data) {
        console.error('[WEBHOOK] Formato de record inválido:', record);
        await saveWebhookLog('unknown', 'unknown', record, 2, 'Formato de record inválido', null);
        continue;
      }

      // BranchId en el payload de PowerSales llega como objeto: { Id: 9, Number: "9", Name: "..." }
      const rawBranch = record.data?.BranchId;
      const branchId  = typeof rawBranch === 'object' ? (rawBranch?.Id ?? null) : (rawBranch ?? null);

      const objType = record.object;
      let entidad, clave;

      if (objType === 'products' || objType === 'product' || objType === 'articulos') {
        entidad = 'articulo';
        clave   = record.key.SKU || record.key.ProductCode || JSON.stringify(record.key);
      } else if (objType === 'customers' || objType === 'customer' || objType === 'clientes') {
        entidad = 'cliente';
        clave   = record.key.CustomerNumber || record.key.UniqueId || JSON.stringify(record.key);
      } else {
        entidad = objType;
        clave   = JSON.stringify(record.key);
        console.log(`[WEBHOOK] Objeto ignorado (Aún no implementado): ${objType}`);
      }

      await saveWebhookLog(entidad, clave, record.data, 1, null, branchId);
      console.log(`[WEBHOOK] Guardado — entidad: ${entidad}, clave: ${clave}, branch: ${branchId}`);
    }
  } catch (err) {
    console.error('[WEBHOOK] Error procesando payload:', err.message);
  }
});

module.exports = router;
