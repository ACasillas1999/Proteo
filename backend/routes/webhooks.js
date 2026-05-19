'use strict';
const router = require('express').Router();
const { query } = require('../src/db');
const { PS_FIELDS } = require('../src/handlers/articulo');
const { getFieldMapping, saveWebhookLog, localQuery } = require('../src/localdb');

// Middleware de autenticación
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

// Endpoint para obtener el historial (logs)
router.get('/logs', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 25;
    const offset = (page - 1) * limit;

    let sqlWhere = '1=1';
    const params = [];
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

    const [rows] = await localQuery(
      `SELECT * FROM webhook_logs WHERE ${sqlWhere} ORDER BY fecha_recepcion DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [countRows] = await localQuery(`SELECT COUNT(*) as total FROM webhook_logs WHERE ${sqlWhere}`, countParams);
    const total = countRows[0].total;

    res.json({ ok: true, data: rows, total });
  } catch (err) {
    console.error('[WEBHOOKS API] Error fetching logs:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/powersales/object-update', authenticateWebhook, async (req, res) => {
  // Respondemos 200 OK inmediatamente para evitar timeouts del lado de PowerSales
  res.status(200).json({ ok: true, message: 'Webhook received' });

  // Procesamos el payload en background
  try {
    const payload = req.body;
    
    // Normalizamos: PowerSales puede enviar { object, key, data } o { records: [...] }
    const records = payload.records ? payload.records : [payload];

    for (const record of records) {
      if (!record.object || !record.key || !record.data) {
        console.error('[WEBHOOK] Formato de record inválido:', record);
        await saveWebhookLog('unknown', 'unknown', record, 2, 'Formato de record inválido');
        continue;
      }

      const objType = record.object;
      
      // Soportar "products", "articulos" o "product"
      if (objType === 'products' || objType === 'product' || objType === 'articulos') {
        await handleProductUpdate(record.key, record.data);
      } else {
        console.log(`[WEBHOOK] Objeto ignorado (Aún no implementado): ${objType}`);
        await saveWebhookLog(objType, JSON.stringify(record.key), record.data, 2, 'Objeto ignorado (Aún no implementado)');
      }
    }
  } catch (err) {
    console.error('[WEBHOOK] Error procesando payload:', err.message);
  }
});

/**
 * Mapea los datos del JSON de PowerSales hacia las columnas de la tabla 'articulo'
 * @param {object} key Claves del objeto (ej. { SKU: '...' })
 * @param {object} data Datos a actualizar (ej. { Name: '...', Cost: 100 })
 */
async function handleProductUpdate(key, data) {
  // Extraemos el SKU (Clave_Articulo). Puede venir en la key o en la data.
  const sku = key.SKU || key.ProductCode || data.SKU;
  if (!sku) {
    console.error('[WEBHOOK] Producto sin SKU en key:', key);
    await saveWebhookLog('articulo', JSON.stringify(key), data, 2, 'Producto sin SKU');
    return;
  }

  // Cargar el mapeo dinámico inverso configurado en Proteo
  const fieldMap = await getFieldMapping('articulo');
  
  const updateFields = [];
  const updateValues = [];

  for (const def of PS_FIELDS) {
    // Verificamos si PowerSales nos envió un valor para este campo
    if (data[def.field] !== undefined) {
      const erpCol = fieldMap[def.field] !== undefined ? fieldMap[def.field] : def.defaultErp;
      
      // Si el campo tiene un mapeo a una columna real del ERP local (que no sea null/falso)
      if (erpCol && def.type !== 'fixed' && def.type !== 'fixedId') {
        updateFields.push(`${erpCol} = ?`);
        
        // Transformación de tipo inversa a la BD local
        let val = data[def.field];
        if (def.type === 'boolean') {
          val = val ? 1 : 0;
        } else if (def.type === 'number' || def.type === 'numStr') {
          val = val === null ? null : Number(val);
        }
        
        updateValues.push(val);
      }
    }
  }

  if (updateFields.length > 0) {
    // Agregamos el valor para la cláusula WHERE
    updateValues.push(sku); 
    const sql = `UPDATE articulo SET ${updateFields.join(', ')} WHERE Clave_Articulo = ?`;
    
    try {
      const [result] = await query(sql, updateValues);
      if (result.affectedRows > 0) {
        // [ANTI-ECHO] Marcamos cualquier registro en Cambios pendiente de este artículo como "sincronizado=1"
        // para que el worker (processor.js) no lo regrese a PowerSales, evitando un ciclo redundante.
        await query(`UPDATE Cambios SET sincronizado = 1, fecha_sync = NOW() WHERE tabla = 'articulo' AND clave_registro = ? AND sincronizado = 0`, [sku]).catch(() => {});
        
        console.log(`[WEBHOOK] Producto actualizado exitosamente en BD local (SKU: ${sku})`);
        await saveWebhookLog('articulo', sku, data, 1, null);
      } else {
        console.log(`[WEBHOOK] Producto no encontrado en BD local, no se pudo actualizar (SKU: ${sku})`);
        await saveWebhookLog('articulo', sku, data, 2, 'Producto no encontrado en BD local');
      }
    } catch (dbErr) {
      console.error(`[WEBHOOK] Error DB al actualizar producto (SKU: ${sku}):`, dbErr.message);
      await saveWebhookLog('articulo', sku, data, 2, `Error DB al actualizar: ${dbErr.message}`);
    }
  } else {
    console.log(`[WEBHOOK] Ningún campo mapeado para actualizar en producto (SKU: ${sku})`);
    await saveWebhookLog('articulo', sku, data, 2, 'Ningún campo mapeado para actualizar');
  }
}

module.exports = router;
