'use strict';
const { query, getPool }             = require('./db');
const { PS_FIELDS: ARTICULO_FIELDS } = require('./handlers/articulo');
const { PS_FIELDS: CLIENTE_FIELDS }  = require('./handlers/cliente');
const { PS_FIELDS_CABECERA, PS_FIELDS_DETALLE } = require('./handlers/pedido');
const { getFieldMapping, getConfig, saveWebhookLog: saveLogDb } = require('./localdb');
const { broadcast }                  = require('./websocket');

async function saveWebhookLog(entidad, clave_registro, datos, estado, error_msg = null) {
  try {
    await saveLogDb(entidad, clave_registro, datos, estado, error_msg, null);
  } catch (dbErr) {
    console.error('[WEBHOOK LOG DB ERROR]', dbErr.message);
  }
  broadcast('webhook_processed', {
    entidad,
    clave_registro,
    datos,
    estado,
    error_msg,
    fecha_recepcion: new Date().toISOString()
  });
}

async function handleProductUpdate(key, data) {
  const sku = key.SKU || key.ProductCode || data.SKU;
  if (!sku) {
    console.error('[WEBHOOK] Producto sin SKU en key:', key);
    await saveWebhookLog('articulo', JSON.stringify(key), data, 2, 'Producto sin SKU');
    return;
  }

  const fieldMap     = await getFieldMapping('articulo');
  const updatePairsMap = new Map();

  for (const def of ARTICULO_FIELDS) {
    if (data[def.field] !== undefined) {
      const erpCol = fieldMap[def.field] !== undefined ? fieldMap[def.field] : def.defaultErp;
      if (erpCol && def.type !== 'fixed' && def.type !== 'fixedId') {
        let val = data[def.field];
        if (def.type === 'boolean')                       val = val ? 1 : 0;
        else if (def.type === 'number' || def.type === 'numStr') val = val === null ? null : Number(val);
        updatePairsMap.set(erpCol, val);
      }
    }
  }

  const updateFields = [];
  const updateValues = [];
  for (const [col, val] of updatePairsMap.entries()) {
    updateFields.push(`${col} = ?`);
    updateValues.push(val);
  }

  if (updateFields.length === 0) {
    console.log(`[WEBHOOK] Ningún campo mapeado para actualizar en producto (SKU: ${sku})`);
    await saveWebhookLog('articulo', sku, data, 2, 'Ningún campo mapeado para actualizar');
    return;
  }

  updateValues.push(sku);
  const sql = `UPDATE articulo SET ${updateFields.join(', ')} WHERE Clave_Articulo = ?`;
  try {
    const [result] = await query(sql, updateValues);
    if (result.affectedRows > 0) {
      await query(
        `UPDATE Cambios SET sincronizado = 1, fecha_sync = NOW() WHERE tabla = 'articulo' AND clave_registro = ? AND sincronizado = 0`,
        [sku]
      ).catch(() => {});
      console.log(`[WEBHOOK] Producto actualizado exitosamente en BD local (SKU: ${sku})`);
      await saveWebhookLog('articulo', sku, data, 1, null);
    } else {
      console.log(`[WEBHOOK] Producto no encontrado en BD local (SKU: ${sku})`);
      await saveWebhookLog('articulo', sku, data, 2, 'Producto no encontrado en BD local');
    }
  } catch (dbErr) {
    console.error(`[WEBHOOK] Error DB al actualizar producto (SKU: ${sku}):`, dbErr.message);
    await saveWebhookLog('articulo', sku, data, 2, `Error DB al actualizar: ${dbErr.message}`);
  }
}

async function handleCustomerUpdate(key, data) {
  const customerNumber = key.CustomerNumber || key.UniqueId || data.CustomerNumber;
  if (!customerNumber) {
    console.error('[WEBHOOK] Cliente sin CustomerNumber/UniqueId en key:', key);
    await saveWebhookLog('cliente', JSON.stringify(key), data, 2, 'Cliente sin CustomerNumber/UniqueId');
    return;
  }

  try {
    const fieldMap  = await getFieldMapping('cliente');
    const customerPairsMap = new Map();
    let emailValue  = undefined;

    for (const def of CLIENTE_FIELDS) {
      if (data[def.field] !== undefined) {
        const erpCol = fieldMap[def.field] !== undefined ? fieldMap[def.field] : def.defaultErp;
        if (erpCol && def.type !== 'fixed' && def.type !== 'fixedId') {
          if (erpCol === 'e_mail') { emailValue = data[def.field]; continue; }
          let val = data[def.field];
          if (def.type === 'boolean')                            val = val ? 1 : 0;
          else if (def.type === 'number' || def.type === 'numStr') val = val === null ? null : Number(val);
          customerPairsMap.set(erpCol, val);
        }
      }
    }

    const colNames  = Array.from(customerPairsMap.keys());
    const colValues = Array.from(customerPairsMap.values());

    // lookupCol = columna ERP que corresponde a CustomerNumber (IdGlobal, Cliente, etc.)
    // Se configura en Mapeo UI: CustomerNumber → IdGlobal
    const lookupCol = (fieldMap['CustomerNumber'] != null && fieldMap['CustomerNumber'] !== '')
      ? fieldMap['CustomerNumber']
      : 'IdGlobal';

    const [clientRows] = await query(
      `SELECT * FROM clientes WHERE ${lookupCol} = ? LIMIT 1`,
      [customerNumber]
    );
    let updatedSomething = false;

    if (clientRows.length === 0) {
      // INSERT — cliente nuevo
      // colNames ya incluye lookupCol desde el loop (CustomerNumber → lookupCol)
      const insertCols = colNames.includes(lookupCol)
        ? colNames
        : [lookupCol, ...colNames];
      const insertVals = colNames.includes(lookupCol)
        ? colValues
        : [customerNumber, ...colValues];
      const placeholders = insertCols.map(() => '?').join(', ');
      await query(
        `INSERT INTO clientes (${insertCols.join(', ')}) VALUES (${placeholders})`,
        insertVals
      );
      console.log(`[WEBHOOK] Cliente creado en BD local (${lookupCol}: ${customerNumber})`);
      updatedSomething = true;
    } else if (colNames.length > 0) {
      // UPDATE — cliente existente, filtrar lookupCol del SET (no actualizar el identificador)
      const updateCols = colNames.filter(c => c !== lookupCol);
      const updateVals = colValues.filter((_, i) => colNames[i] !== lookupCol);
      if (updateCols.length > 0) {
        const setClauses = updateCols.map(c => `${c} = ?`).join(', ');
        await query(`UPDATE clientes SET ${setClauses} WHERE ${lookupCol} = ?`, [...updateVals, customerNumber]);
        console.log(`[WEBHOOK] Cliente actualizado en BD local (${lookupCol}: ${customerNumber})`);
        updatedSomething = true;
      }
    }

    if (emailValue !== undefined) {
      await query(
        `INSERT INTO clientes_email (Clave_Cliente, e_mail) VALUES (?, ?) ON DUPLICATE KEY UPDATE e_mail = VALUES(e_mail)`,
        [customerNumber, emailValue]
      );
      updatedSomething = true;
    }

    if (updatedSomething) {
      await query(
        `UPDATE Cambios SET sincronizado = 1, fecha_sync = NOW() WHERE tabla = 'clientes' AND clave_registro = ? AND sincronizado = 0`,
        [customerNumber]
      ).catch(() => {});
      await saveWebhookLog('cliente', customerNumber, data, 1, null);
    } else {
      console.log(`[WEBHOOK] Ningún campo mapeado para actualizar en cliente (Cliente: ${customerNumber})`);
      await saveWebhookLog('cliente', customerNumber, data, 2, 'Ningún campo mapeado para actualizar');
    }
  } catch (dbErr) {
    console.error(`[WEBHOOK] Error DB al actualizar cliente (Cliente: ${customerNumber}):`, dbErr.message);
    await saveWebhookLog('cliente', customerNumber, data, 2, `Error DB al actualizar: ${dbErr.message}`);
  }
}

// Lee un valor de `obj` siguiendo un path con puntos (ej. 'CustomerId.Id')
function getPath(obj, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

async function tableExists(table) {
  const [rows] = await query('SHOW TABLES');
  return rows.some(r => Object.values(r)[0] === table);
}

async function validColumns(table) {
  const [rows] = await query(`SHOW COLUMNS FROM \`${table}\``);
  return rows.map(r => r.Field);
}

async function insertRow(table, colValuePairs) {
  const cols = colValuePairs.map(([c]) => c);
  const vals = colValuePairs.map(([, v]) => v);
  const placeholders = cols.map(() => '?').join(', ');
  const colsSql = cols.map(c => `\`${c}\``).join(', ');
  const [result] = await query(`INSERT INTO \`${table}\` (${colsSql}) VALUES (${placeholders})`, vals);
  return result;
}

// Aplica un pedido (webhook 'orders') a las tablas de Magic elegidas en el Mapeo.
// Corre en la sucursal (aquí sí hay conexión directa al ERP) — ver webhookPoller.js.
async function handleOrderInsert(data) {
  const orderNumber = data.OrderNumber;
  if (!orderNumber) {
    console.error('[WEBHOOK] Pedido sin OrderNumber:', data);
    await saveWebhookLog('orders', 'desconocido', data, 2, 'Pedido sin OrderNumber');
    return;
  }

  try {
    const [fieldMapCab, fieldMapDet, cabTable, detTable] = await Promise.all([
      getFieldMapping('pedido_cabecera'),
      getFieldMapping('pedido_detalle'),
      getConfig('pedido_cabecera_table', ''),
      getConfig('pedido_detalle_table', ''),
    ]);

    if (!cabTable) {
      console.log(`[WEBHOOK] Pedido ${orderNumber}: no hay tabla de cabecera configurada en Mapeo`);
      await saveWebhookLog('orders', orderNumber, data, 2, 'Tabla de cabecera no configurada en Mapeo');
      return;
    }
    if (!(await tableExists(cabTable))) {
      await saveWebhookLog('orders', orderNumber, data, 2, `Tabla de cabecera '${cabTable}' no existe en el ERP`);
      return;
    }

    const cabCols = await validColumns(cabTable);
    const headerPairsMap = new Map();
    for (const def of PS_FIELDS_CABECERA) {
      const erpCol = fieldMapCab[def.field];
      if (!erpCol) continue;
      // Buscar el nombre real de la columna con la casing exacta de la BD para evitar duplicados por diferencias de mayúsculas/minúsculas
      const realCol = cabCols.find(c => c.toLowerCase() === erpCol.toLowerCase());
      if (!realCol) continue;

      let val = getPath(data, def.field);
      if (val === undefined) continue;

      // Conversión especial para Condicion_Pago (max 4 caracteres)
      if (realCol.toLowerCase() === 'condicion_pago' && typeof val === 'string') {
        const upperVal = val.toUpperCase().trim();
        if (upperVal === 'CONTADO') {
          val = 'CONT';
        } else if (upperVal === 'CREDITO') {
          val = 'CRE';
        }
      }

      // Conversión especial para TipoPedido (max 1 carácter)
      if (realCol.toLowerCase() === 'tipopedido' && typeof val === 'string') {
        const upperVal = val.toUpperCase().trim();
        if (upperVal === 'RECOGE' || upperVal === 'CLIENTE AVISA') {
          val = 'M';
        } else if (upperVal === 'ENVIA' || upperVal === 'ENVÍA') {
          val = 'E';
        } else {
          val = val.substring(0, 1).toUpperCase();
        }
      }

      // Truncar campos de clave de vendedor/atendió (max 6 caracteres)
      if (['cve_atendio', 'cve_vendedor', 'cotizador', 'asesor'].includes(realCol.toLowerCase()) && val !== null && val !== undefined) {
        val = String(val).substring(0, 6);
      }

      // Truncar No_OC (max 11 caracteres)
      if (realCol.toLowerCase() === 'no_oc' && val !== null && val !== undefined) {
        val = String(val).substring(0, 11);
      }

      headerPairsMap.set(realCol, val);
    }

    // Reglas de negocio para el Pedido (Estatus_Pedido y AfectarInventario)
    const orderTypeVal = typeof data.OrderType === 'string' ? data.OrderType.toUpperCase().trim() : '';
    const realEstatusCol = cabCols.find(c => c.toLowerCase() === 'estatus_pedido');
    const realAfectarCol = cabCols.find(c => c.toLowerCase() === 'afectarinventario');

    if (orderTypeVal.includes('ANEXO')) {
      if (realEstatusCol) {
        headerPairsMap.set(realEstatusCol, 'P');
      }
      if (realAfectarCol) {
        headerPairsMap.set(realAfectarCol, 1);
      }
    } else if (orderTypeVal.includes('NORMAL') || orderTypeVal.includes('REMISION')) {
      if (realEstatusCol) {
        headerPairsMap.set(realEstatusCol, 'P');
      }
    } else {
      // Caso por defecto / Otros tipos de pedido (abierto a futuros cambios de estatus)
      if (realEstatusCol) {
        headerPairsMap.set(realEstatusCol, 'P');
      }
    }

    // Buscar el ID local de Magic (Cliente) usando IdGlobal = CustomerNumber de PowerSales
    const customerNumber = getPath(data, 'CustomerId.CustomerNumber');
    if (customerNumber) {
      try {
        const [clientRows] = await query("SELECT Cliente FROM clientes WHERE IdGlobal = ? LIMIT 1", [customerNumber]);
        if (clientRows.length > 0) {
          const localClienteId = clientRows[0].Cliente;
          const erpClientCol = fieldMapCab['CustomerId.CustomerNumber'] || fieldMapCab['CustomerId.Id'];
          if (erpClientCol) {
            const realClientCol = cabCols.find(c => c.toLowerCase() === erpClientCol.toLowerCase());
            if (realClientCol) {
              headerPairsMap.set(realClientCol, localClienteId);
              console.log(`[WEBHOOK] Mapeado CustomerNumber ${customerNumber} a ID local Cliente ${localClienteId} en columna ${realClientCol}`);
            }
          }
        }
      } catch (cliErr) {
        console.error(`[WEBHOOK] Error al buscar ID local de cliente:`, cliErr.message);
      }
    }

    // Buscar el ID local de Vendedor usando Usuario = RouteId.Name de PowerSales
    const routeName = getPath(data, 'RouteId.Name');
    if (routeName) {
      try {
        const [vendedorRows] = await query(
          "SELECT Cve_Vendedor FROM vendedor WHERE Usuario = ? AND TipoEmpleado IN ('V', 'Y') LIMIT 1",
          [routeName]
        );
        if (vendedorRows.length > 0) {
          const localVendedorId = vendedorRows[0].Cve_Vendedor;
          
          const realCveAtendioCol  = cabCols.find(c => c.toLowerCase() === 'cve_atendio');
          const realCveVendedorCol = cabCols.find(c => c.toLowerCase() === 'cve_vendedor');
          const realCotizadorCol   = cabCols.find(c => c.toLowerCase() === 'cotizador');

          if (realCveAtendioCol) {
            headerPairsMap.set(realCveAtendioCol, localVendedorId);
          }
          if (realCveVendedorCol) {
            headerPairsMap.set(realCveVendedorCol, localVendedorId);
          }
          if (realCotizadorCol) {
            headerPairsMap.set(realCotizadorCol, localVendedorId);
          }
          console.log(`[WEBHOOK] Mapeado RouteId.Name '${routeName}' a Cve_Vendedor local '${localVendedorId}'`);
        }
      } catch (vendErr) {
        console.error(`[WEBHOOK] Error al buscar ID local de vendedor:`, vendErr.message);
      }
    }

    let nextFolio = null;
    let insertResult = null;
    
    // Si la tabla es cbpedvta, iniciamos una transacción para leer y actualizar ctrlcons de manera segura
    if (cabTable.toLowerCase() === 'cbpedvta') {
      const pool = getPool();
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        // 1. Obtener y bloquear el consecutivo actual para Tipo = 'NPED'
        const [ctrlRows] = await connection.execute("SELECT Consec_Num FROM ctrlcons WHERE Tipo = 'NPED' FOR UPDATE");
        if (ctrlRows.length === 0) {
          throw new Error("No se encontró el tipo de consecutivo 'NPED' en la tabla ctrlcons.");
        }

        nextFolio = ctrlRows[0].Consec_Num + 1;

        // 2. Insertar el folio generado en el mapeo con la casing exacta de la BD
        const realPKCol = cabCols.find(c => c.toLowerCase() === 'no_pedido');
        if (realPKCol) {
          headerPairsMap.set(realPKCol, nextFolio);
        }

        const headerPairs = Array.from(headerPairsMap.entries());
        if (headerPairs.length === 0) {
          throw new Error('Ningún campo de cabecera mapeado');
        }

        // 3. Insertar la cabecera del pedido
        const cols = headerPairs.map(([c]) => c);
        const vals = headerPairs.map(([, v]) => v);
        const placeholders = cols.map(() => '?').join(', ');
        const colsSql = cols.map(c => `\`${c}\``).join(', ');

        const [insertRes] = await connection.execute(`INSERT INTO \`${cabTable}\` (${colsSql}) VALUES (${placeholders})`, vals);
        insertResult = insertRes;

        // 4. Actualizar el consecutivo en ctrlcons
        await connection.execute("UPDATE ctrlcons SET Consec_Num = ? WHERE Tipo = 'NPED'", [nextFolio]);
        console.log(`[WEBHOOK] Pedido insertado con Folio (No_Pedido): ${nextFolio} y consecutivo actualizado en ctrlcons.`);

        await connection.commit();
      } catch (txErr) {
        await connection.rollback();
        throw txErr;
      } finally {
        connection.release();
      }
    } else {
      // Flujo genérico sin transacción (para otras tablas que sí sean autoincrementales)
      const headerPairs = Array.from(headerPairsMap.entries());
      if (headerPairs.length === 0) {
        await saveWebhookLog('orders', orderNumber, data, 2, 'Ningún campo de cabecera mapeado');
        return;
      }
      insertResult = await insertRow(cabTable, headerPairs);
      console.log(`[WEBHOOK] Registro insertado en '${cabTable}'`);
    }

    const details = Array.isArray(data.details) ? data.details : [];
    if (details.length > 0 && detTable) {
      if (!(await tableExists(detTable))) {
        await saveWebhookLog('orders', orderNumber, data, 2, `Cabecera insertada, pero tabla de renglones '${detTable}' no existe`);
        return;
      }
      const detCols = await validColumns(detTable);

      let partidaIndex = 1;
      for (const item of details) {
        const rowPairsMap = new Map();

        // 1. Forzar la llave de relación con la cabecera (No_Pedido)
        const realFKCol = detCols.find(c => c.toLowerCase() === 'no_pedido');
        if (realFKCol && (nextFolio || (insertResult && insertResult.insertId))) {
          rowPairsMap.set(realFKCol, nextFolio || insertResult.insertId);
        }

        // 2. Forzar/Autocompletar la columna 'Partida' (número de renglón) si existe
        const realPartidaCol = detCols.find(c => c.toLowerCase() === 'partida');
        if (realPartidaCol) {
          rowPairsMap.set(realPartidaCol, partidaIndex++);
        }

        // 3. Procesar campos mapeados
        for (const def of PS_FIELDS_DETALLE) {
          const erpCol = fieldMapDet[def.field];
          if (!erpCol) continue;
          // Buscar el nombre real de la columna con la casing exacta de la BD
          const realCol = detCols.find(c => c.toLowerCase() === erpCol.toLowerCase());
          if (!realCol) continue;

          // Si es la columna FK o Partida y ya la agregamos, la omitimos aquí
          if (realCol === realFKCol || realCol === realPartidaCol) continue;

          const val = def.field === 'OrderNumber' ? (nextFolio || orderNumber) : item[def.field];
          if (val === undefined) continue;
          rowPairsMap.set(realCol, val);
        }
        const rowPairs = Array.from(rowPairsMap.entries());
        if (rowPairs.length > 0) await insertRow(detTable, rowPairs);
      }
      console.log(`[WEBHOOK] Pedido ${orderNumber}: ${details.length} renglón(es) insertados en '${detTable}'`);
    } else if (details.length > 0 && !detTable) {
      console.log(`[WEBHOOK] Pedido ${orderNumber}: cabecera insertada, pero no hay tabla de renglones configurada`);
    }

    await saveWebhookLog('orders', orderNumber, data, 1, null);
  } catch (dbErr) {
    console.error(`[WEBHOOK] Error DB al insertar pedido ${orderNumber}:`, dbErr.message);
    await saveWebhookLog('orders', orderNumber, data, 2, `Error DB al insertar: ${dbErr.message}`);
  }
}

module.exports = { handleProductUpdate, handleCustomerUpdate, handleOrderInsert };
