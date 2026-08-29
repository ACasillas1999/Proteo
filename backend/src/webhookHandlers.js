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

  const rawBranch = data?.BranchId ?? data?.details_promo?.[0]?.order?.BranchId;
  const branchName = (rawBranch && typeof rawBranch === 'object' && rawBranch.Name)
    ? rawBranch.Name
    : 'AIESA';

  try {
    const [
      fieldMapCab, fieldMapDet, cabTable, detTable,
      fieldMapCotCab, fieldMapCotDet, cotCabTable, cotDetTable
    ] = await Promise.all([
      getFieldMapping('pedido_cabecera'),
      getFieldMapping('pedido_detalle'),
      getConfig('pedido_cabecera_table', ''),
      getConfig('pedido_detalle_table', ''),
      getFieldMapping('cotizacion_cabecera'),
      getFieldMapping('cotizacion_detalle'),
      getConfig('cotizacion_cabecera_table', 'cbcot'),
      getConfig('cotizacion_detalle_table', 'dtcot'),
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

    // 1. Verificar si el pedido ya existe en el ERP
    let exists = false;
    let existingNoPedido = null;

    const erpIdCol = fieldMapCab['Id'];
    const erpOrderNumberCol = fieldMapCab['OrderNumber'];
    const conditions = [];
    const queryParams = [];

    if (erpIdCol && data.Id) {
      conditions.push(`CONVERT(\`${erpIdCol}\` USING utf8mb4) = ?`);
      queryParams.push(data.Id);
    }
    if (erpOrderNumberCol && data.OrderNumber) {
      conditions.push(`CONVERT(\`${erpOrderNumberCol}\` USING utf8mb4) = ?`);
      queryParams.push(data.OrderNumber);
    }
    if (data.OrderNumber && !isNaN(data.OrderNumber)) {
      conditions.push(`No_Pedido = ?`);
      queryParams.push(parseInt(data.OrderNumber));
    }
    if (data.Id && !isNaN(data.Id)) {
      conditions.push(`No_Pedido = ?`);
      queryParams.push(parseInt(data.Id));
    }

    if (conditions.length > 0) {
      try {
        const [existingRows] = await query(
          `SELECT No_Pedido FROM \`${cabTable}\` WHERE ${conditions.join(' OR ')} LIMIT 1`,
          queryParams
        );
        if (existingRows.length > 0) {
          exists = true;
          existingNoPedido = existingRows[0].No_Pedido;
        }
      } catch (errExists) {
        console.error('[WEBHOOK] Error al verificar existencia del pedido:', errExists.message);
      }
    }

    // 2. Si el pedido ya existe, actualizamos la columna Distribuido únicamente si StatusId es 41 (pasa a 0) o 11 (pasa a 1), o Estatus_Pedido a 'C' si es 8 (CANCELLED)
    if (exists) {
      console.log(`[WEBHOOK] Pedido ${orderNumber} ya existe con No_Pedido: ${existingNoPedido}.`);
      if (data.StatusId !== undefined || data.StatusName !== undefined) {
        const statusIdNum = parseInt(data.StatusId);
        const statusNameVal = typeof data.StatusName === 'string' ? data.StatusName.toUpperCase().trim() : '';

        if (statusIdNum === 8 || statusNameVal.includes('CANCEL')) {
          console.log(`[WEBHOOK] StatusId es 8 / Cancelado. Actualizando 'Estatus_Pedido' a 'C' en No_Pedido: ${existingNoPedido}`);
          const realEstatusCol = cabCols.find(c => c.toLowerCase() === 'estatus_pedido');
          if (realEstatusCol) {
            await query(
              `UPDATE \`${cabTable}\` SET \`${realEstatusCol}\` = 'C' WHERE No_Pedido = ?`,
              [existingNoPedido]
            );
          }
        } else if (statusIdNum === 41) {
          console.log(`[WEBHOOK] StatusId es 41. Actualizando 'Distribuido' a 0 en No_Pedido: ${existingNoPedido}`);
          const realDistCol = cabCols.find(c => c.toLowerCase() === 'distribuido');
          if (realDistCol) {
            await query(
              `UPDATE \`${cabTable}\` SET \`${realDistCol}\` = ? WHERE No_Pedido = ?`,
              [0, existingNoPedido]
            );
          }
        } else if (statusIdNum === 11) {
          console.log(`[WEBHOOK] StatusId es 11. Actualizando 'Distribuido' a 1 en No_Pedido: ${existingNoPedido}`);
          const realDistCol = cabCols.find(c => c.toLowerCase() === 'distribuido');
          if (realDistCol) {
            await query(
              `UPDATE \`${cabTable}\` SET \`${realDistCol}\` = ? WHERE No_Pedido = ?`,
              [1, existingNoPedido]
            );
          }
        }
      }

      // Si el pedido ya existe pero NO tiene renglones en la tabla de detalles y este webhook sí incluye renglones, insertarlos
      const detailsArr = Array.isArray(data.details) ? data.details : [];
      if (detailsArr.length > 0 && detTable && (await tableExists(detTable))) {
        const [existingDetRows] = await query(
          `SELECT COUNT(*) AS total FROM \`${detTable}\` WHERE No_Pedido = ?`,
          [existingNoPedido]
        );
        if (existingDetRows[0].total === 0) {
          console.log(`[WEBHOOK] Pedido ${orderNumber} ya existía pero tenía 0 renglones. Insertando ${detailsArr.length} renglón(es) en '${detTable}'...`);
          const detCols = await validColumns(detTable);
          let partidaIndex = 1;
          const todayStr = new Date().toISOString().split('T')[0];
          const timeStr = new Date().toTimeString().split(' ')[0];

          for (const item of detailsArr) {
            const rowPairsMap = new Map();
            const realFKCol = detCols.find(c => c.toLowerCase() === 'no_pedido');
            if (realFKCol) rowPairsMap.set(realFKCol, existingNoPedido);

            const realPartidaCol = detCols.find(c => c.toLowerCase() === 'partida');
            if (realPartidaCol) rowPairsMap.set(realPartidaCol, partidaIndex++);

            for (const def of PS_FIELDS_DETALLE) {
              const erpCol = fieldMapDet[def.field];
              if (!erpCol) continue;
              const realCol = detCols.find(c => c.toLowerCase() === erpCol.toLowerCase());
              if (!realCol || realCol === realFKCol || realCol === realPartidaCol) continue;

              const val = def.field === 'OrderNumber' ? existingNoPedido : item[def.field];
              if (val === undefined) continue;
              rowPairsMap.set(realCol, val);
            }

            setIfColExists(rowPairsMap, detCols, 'Cant_Facturar', Number(item.QtyOrdered || item.Qty || 0));
            setIfColExists(rowPairsMap, detCols, 'Cant_Facturada', 0.0);
            setIfColExists(rowPairsMap, detCols, 'Fech_Captura', todayStr);
            setIfColExists(rowPairsMap, detCols, 'Hora_Captura', timeStr);

            const rowPairs = Array.from(rowPairsMap.entries());
            if (rowPairs.length > 0) {
              const rCols = rowPairs.map(([c]) => c);
              const rVals = rowPairs.map(([, v]) => v);
              const rPlaceholders = rCols.map(() => '?').join(', ');
              const rColsSql = rCols.map(c => `\`${c}\``).join(', ');
              await query(`INSERT INTO \`${detTable}\` (${rColsSql}) VALUES (${rPlaceholders})`, rVals);
            }
          }
        }
      }

      await saveWebhookLog('orders', orderNumber, data, 1, null);
      return;
    }

    // 3. Si el pedido NO existe, realizamos las búsquedas de relaciones locales
    const customerNumber = getPath(data, 'CustomerId.CustomerNumber') || getPath(data, 'CustomerId.Id');
    let localClienteId = null;
    if (customerNumber) {
      try {
        const [clientRows] = await query(
          "SELECT Cliente FROM clientes WHERE IdGlobal = ? LIMIT 1",
          [customerNumber]
        );
        if (clientRows.length > 0) {
          localClienteId = clientRows[0].Cliente;
        }
      } catch (cliErr) {
        console.error(`[WEBHOOK] Error al buscar ID local de cliente por IdGlobal:`, cliErr.message);
      }
    }

    const routeName = getPath(data, 'RouteId.Name');
    let localVendedorId = null;
    if (routeName) {
      try {
        const [vendedorRows] = await query(
          "SELECT Cve_Vendedor FROM vendedor WHERE Usuario = ? AND TipoEmpleado IN ('V', 'Y') LIMIT 1",
          [routeName]
        );
        if (vendedorRows.length > 0) {
          localVendedorId = vendedorRows[0].Cve_Vendedor;
        }
      } catch (vendErr) {
        console.error(`[WEBHOOK] Error al buscar ID local de vendedor:`, vendErr.message);
      }
    }

    // 4. Mapear datos para el Pedido Cabecera
    const headerPairsMap = new Map();
    for (const def of PS_FIELDS_CABECERA) {
      const erpCol = fieldMapCab[def.field];
      if (!erpCol) continue;
      const realCol = cabCols.find(c => c.toLowerCase() === erpCol.toLowerCase());
      if (!realCol) continue;

      let val = getPath(data, def.field);
      if (val === undefined) continue;

      if (realCol.toLowerCase() === 'condicion_pago' && typeof val === 'string') {
        const upperVal = val.toUpperCase().trim();
        if (upperVal === 'CONTADO') val = 'CONT';
        else if (upperVal === 'CREDITO') val = 'CRE';
      }

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

      if (['cve_atendio', 'cve_vendedor', 'cotizador', 'asesor'].includes(realCol.toLowerCase()) && val !== null && val !== undefined) {
        val = String(val).substring(0, 6);
      }

      if (realCol.toLowerCase() === 'no_oc' && val !== null && val !== undefined) {
        val = String(val).substring(0, 11);
      }

      headerPairsMap.set(realCol, val);
    }

    const statusIdVal = parseInt(data.StatusId);
    const statusNameVal = typeof data.StatusName === 'string' ? data.StatusName.toUpperCase().trim() : '';
    const orderTypeVal = typeof data.OrderType === 'string' ? data.OrderType.toUpperCase().trim() : '';
    const realEstatusCol = cabCols.find(c => c.toLowerCase() === 'estatus_pedido');
    const realAfectarCol = cabCols.find(c => c.toLowerCase() === 'afectarinventario');

    if (statusIdVal === 8 || statusNameVal.includes('CANCEL')) {
      if (realEstatusCol) headerPairsMap.set(realEstatusCol, 'C');
    } else if (orderTypeVal.includes('ANEXO')) {
      if (realEstatusCol) headerPairsMap.set(realEstatusCol, 'P');
      if (realAfectarCol) headerPairsMap.set(realAfectarCol, 0);
    } else if (orderTypeVal.includes('NORMAL') || orderTypeVal.includes('REMISION')) {
      if (realEstatusCol) headerPairsMap.set(realEstatusCol, 'P');
    } else {
      if (realEstatusCol) headerPairsMap.set(realEstatusCol, 'P');
    }

    if (localClienteId) {
      const erpClientCol = fieldMapCab['CustomerId.CustomerNumber'] || fieldMapCab['CustomerId.Id'] || 'Cve_Cte';
      const realClientCol = cabCols.find(c => c.toLowerCase() === erpClientCol.toLowerCase())
        || cabCols.find(c => ['cve_cte', 'cve_cliente', 'cliente'].includes(c.toLowerCase()));
      if (realClientCol) headerPairsMap.set(realClientCol, localClienteId);
    }

    if (localVendedorId) {
      const realCveAtendioCol  = cabCols.find(c => c.toLowerCase() === 'cve_atendio');
      const realCveVendedorCol = cabCols.find(c => c.toLowerCase() === 'cve_vendedor');
      const realCotizadorCol   = cabCols.find(c => c.toLowerCase() === 'cotizador');
      if (realCveAtendioCol)  headerPairsMap.set(realCveAtendioCol, localVendedorId);
      if (realCveVendedorCol) headerPairsMap.set(realCveVendedorCol, localVendedorId);
      if (realCotizadorCol)   headerPairsMap.set(realCotizadorCol, localVendedorId);
    }

    const rawPoVal = getPath(data, 'PurchaseOrderNumber') || getPath(data, 'details_promo.0.order.PurchaseOrderNumber') || '';
    const poVal = rawPoVal ? String(rawPoVal).trim() : '';
    if (poVal) {
      const realNoOcCol = cabCols.find(c => c.toLowerCase() === 'no_oc' || c.toLowerCase() === 'oc');
      if (realNoOcCol) headerPairsMap.set(realNoOcCol, poVal.substring(0, 11));
    }

    // 5. Helper local para agregar columnas por defecto si no están mapeadas
    const setIfColExists = (map, cols, colName, value) => {
      const realCol = cols.find(c => c.toLowerCase() === colName.toLowerCase());
      if (realCol && !map.has(realCol)) {
        map.set(realCol, value);
      }
    };

    const forceColValue = (map, cols, colName, value) => {
      const realCol = cols.find(c => c.toLowerCase() === colName.toLowerCase());
      if (realCol) {
        map.set(realCol, value);
      }
    };

    const todayStr = new Date().toISOString().split('T')[0];
    const timeStr  = new Date().toTimeString().split(' ')[0];

    const totalAmountVal = Number(data.TotalAmount || 0);
    const totalTaxVal    = Number(data.TotalTax || 0);
    const calculatedSubtotal = Math.max(0, Number((totalAmountVal - totalTaxVal).toFixed(4)));

    forceColValue(headerPairsMap, cabCols, 'Subtotal', calculatedSubtotal);
    forceColValue(headerPairsMap, cabCols, 'Total', totalAmountVal);
    forceColValue(headerPairsMap, cabCols, 'IVA_Porcentaje', 16);

    setIfColExists(headerPairsMap, cabCols, 'Fech_Captura', todayStr);
    setIfColExists(headerPairsMap, cabCols, 'Hora_Captura', timeStr);
    setIfColExists(headerPairsMap, cabCols, 'Asesor', branchName.substring(0, 6));
    if (cabTable.toLowerCase() !== 'cbpedvta') {
      setIfColExists(headerPairsMap, cabCols, 'Proyecto', 'NA');
    } else {
      setIfColExists(headerPairsMap, cabCols, 'ProyectoReferencia', 'NA');
    }

    const details = Array.isArray(data.details) ? data.details : [];

    // Consultar Precio_Especial de la tabla 'articulo' para los SKUs del detalle
    const skuList = details
      .map(item => String(item.ProductId || item.ProductCode || item.SKU || item.product?.SKU || '').trim())
      .filter(Boolean);

    const precioEspecialMap = new Map();
    if (skuList.length > 0) {
      try {
        const placeholders = skuList.map(() => '?').join(', ');
        const [artRows] = await query(
          `SELECT Clave_Articulo, Precio_Especial FROM articulo WHERE Clave_Articulo IN (${placeholders})`,
          skuList
        );
        for (const row of artRows) {
          if (row.Clave_Articulo) {
            precioEspecialMap.set(String(row.Clave_Articulo).trim().toLowerCase(), Number(row.Precio_Especial || 0));
          }
        }
      } catch (artErr) {
        console.error('[WEBHOOK] Error al buscar Precio_Especial en articulo:', artErr.message);
      }
    }

    const pool = getPool();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const todayStr = new Date().toISOString().split('T')[0];
      const timeStr = new Date().toTimeString().split(' ')[0];

      // A. INSERTAR COTIZACIÓN (si StatusId es 11)
      let nextCotiza = null;
      if (parseInt(data.StatusId) === 11 && cotCabTable && (await tableExists(cotCabTable))) {
        const [ctrlCotRows] = await connection.execute("SELECT Consec_Num FROM ctrlcons WHERE Tipo = 'COT' FOR UPDATE");
        if (ctrlCotRows.length > 0) {
          nextCotiza = ctrlCotRows[0].Consec_Num + 1;

          const cotCabCols = await validColumns(cotCabTable);
          const headerCotPairsMap = new Map();

          // Consecutivo en pk
          const realPKCotCol = cotCabCols.find(c => c.toLowerCase() === 'no_cotiza');
          if (realPKCotCol) headerCotPairsMap.set(realPKCotCol, nextCotiza);

          // Mapeos definidos por el usuario
          for (const def of PS_FIELDS_CABECERA) {
            const erpCol = fieldMapCotCab[def.field];
            if (!erpCol) continue;
            const realCol = cotCabCols.find(c => c.toLowerCase() === erpCol.toLowerCase());
            if (!realCol || realCol === realPKCotCol) continue;

            let val = getPath(data, def.field);
            if (val === undefined) continue;

            if (realCol.toLowerCase() === 'cond_pago' && typeof val === 'string') {
              const upperVal = val.toUpperCase().trim();
              if (upperVal === 'CONTADO') val = 'CONT';
              else if (upperVal === 'CREDITO') val = 'CRE';
            }
            if (['cve_atendio', 'cve_vendedor', 'cotizador', 'asesor'].includes(realCol.toLowerCase()) && val !== null && val !== undefined) {
              val = String(val).substring(0, 6);
            }
            headerCotPairsMap.set(realCol, val);
          }

          // Inyecciones manuales para Cotización
          if (localClienteId) {
            const erpClientCol = fieldMapCotCab['CustomerId.CustomerNumber'] || fieldMapCotCab['CustomerId.Id'] || 'Cve_Cte';
            const realClientCol = cotCabCols.find(c => c.toLowerCase() === erpClientCol.toLowerCase())
              || cotCabCols.find(c => ['cve_cte', 'cve_cliente', 'cliente'].includes(c.toLowerCase()));
            if (realClientCol) headerCotPairsMap.set(realClientCol, localClienteId);
          }
          if (localVendedorId) {
            const realCveAtendioCol  = cotCabCols.find(c => c.toLowerCase() === 'cve_atendio');
            const realCveVendedorCol = cotCabCols.find(c => c.toLowerCase() === 'cve_vendedor');
            const realCotizadorCol   = cotCabCols.find(c => c.toLowerCase() === 'cotizador');
            if (realCveAtendioCol)  headerCotPairsMap.set(realCveAtendioCol, localVendedorId);
            if (realCveVendedorCol) headerCotPairsMap.set(realCveVendedorCol, localVendedorId);
            if (realCotizadorCol)   headerCotPairsMap.set(realCotizadorCol, localVendedorId);
          }

          if (poVal) {
            const realCotOcCol = cotCabCols.find(c => c.toLowerCase() === 'oc' || c.toLowerCase() === 'no_oc');
            if (realCotOcCol) headerCotPairsMap.set(realCotOcCol, poVal.substring(0, 10));
          }

          if (orderNumber) {
            const realCotIdPsCol = cotCabCols.find(c => c.toLowerCase() === 'idps');
            if (realCotIdPsCol) headerCotPairsMap.set(realCotIdPsCol, String(orderNumber).substring(0, 15));
          }

          forceColValue(headerCotPairsMap, cotCabCols, 'Subtotal', calculatedSubtotal);
          forceColValue(headerCotPairsMap, cotCabCols, 'Total', totalAmountVal);
          forceColValue(headerCotPairsMap, cotCabCols, 'IVA_Porcentaje', 16);

          // Sensible defaults para cotizaciones
          setIfColExists(headerCotPairsMap, cotCabCols, 'Fecha', todayStr);
          setIfColExists(headerCotPairsMap, cotCabCols, 'Fech_Entrega', todayStr);
          setIfColExists(headerCotPairsMap, cotCabCols, 'FechaProbableCierre', todayStr);
          setIfColExists(headerCotPairsMap, cotCabCols, 'Fecha_Captura', todayStr);
          setIfColExists(headerCotPairsMap, cotCabCols, 'Hora_Captura', timeStr);
          setIfColExists(headerCotPairsMap, cotCabCols, 'Moneda', 1);
          setIfColExists(headerCotPairsMap, cotCabCols, 'TC', 1.0);
          setIfColExists(headerCotPairsMap, cotCabCols, 'Contacto', 0);
          setIfColExists(headerCotPairsMap, cotCabCols, 'Dias_Credito', 0);
          setIfColExists(headerCotPairsMap, cotCabCols, 'Aumento_Precio', 0.0);
          setIfColExists(headerCotPairsMap, cotCabCols, 'Descto_Porcentaje', 0.0);
          setIfColExists(headerCotPairsMap, cotCabCols, 'TotalFacturado', 0.0);
          setIfColExists(headerCotPairsMap, cotCabCols, 'Remision', 0);
          setIfColExists(headerCotPairsMap, cotCabCols, 'Almacen', 1);
          setIfColExists(headerCotPairsMap, cotCabCols, 'Sync', 0);
          setIfColExists(headerCotPairsMap, cotCabCols, 'Sugar', 0);
          setIfColExists(headerCotPairsMap, cotCabCols, 'Observaciones', '');
          setIfColExists(headerCotPairsMap, cotCabCols, 'Atencion', '');
          setIfColExists(headerCotPairsMap, cotCabCols, 'OC', '');
          setIfColExists(headerCotPairsMap, cotCabCols, 'IdSugar', '');
          setIfColExists(headerCotPairsMap, cotCabCols, 'Asesor', branchName.substring(0, 6));
          setIfColExists(headerCotPairsMap, cotCabCols, 'AsignoAsesor', branchName.substring(0, 6));
          setIfColExists(headerCotPairsMap, cotCabCols, 'Proyecto', 'NA');
          setIfColExists(headerCotPairsMap, cotCabCols, 'TipoProducto', '');

          const cotCols = Array.from(headerCotPairsMap.keys());
          const cotVals = Array.from(headerCotPairsMap.values());
          const cotPlaceholders = cotCols.map(() => '?').join(', ');
          const cotColsSql = cotCols.map(c => `\`${c}\``).join(', ');

          await connection.execute(`INSERT INTO \`${cotCabTable}\` (${cotColsSql}) VALUES (${cotPlaceholders})`, cotVals);
          await connection.execute("UPDATE ctrlcons SET Consec_Num = ? WHERE Tipo = 'COT'", [nextCotiza]);
          console.log(`[WEBHOOK] Cotización insertada con Folio (No_Cotiza): ${nextCotiza}`);

          // Renglones de cotización
          if (details.length > 0 && cotDetTable && (await tableExists(cotDetTable))) {
            const cotDetCols = await validColumns(cotDetTable);
            let cotPartidaIndex = 1;
            for (const item of details) {
              const rowPairsMap = new Map();

              const realCotFKCol = cotDetCols.find(c => c.toLowerCase() === 'n_cotizacion');
              if (realCotFKCol) rowPairsMap.set(realCotFKCol, nextCotiza);

              const realCotPartidaCol = cotDetCols.find(c => c.toLowerCase() === 'partida');
              if (realCotPartidaCol) rowPairsMap.set(realCotPartidaCol, cotPartidaIndex++);

              for (const def of PS_FIELDS_DETALLE) {
                const erpCol = fieldMapCotDet[def.field];
                if (!erpCol) continue;
                const realCol = cotDetCols.find(c => c.toLowerCase() === erpCol.toLowerCase());
                if (!realCol || realCol === realCotFKCol || realCol === realCotPartidaCol) continue;

                const val = def.field === 'OrderNumber' ? (nextCotiza || orderNumber) : item[def.field];
                if (val === undefined) continue;
                rowPairsMap.set(realCol, val);
              }

              const itemSku = String(item.ProductId || item.ProductCode || item.SKU || item.product?.SKU || item.product?.ProductCode || '').trim();
              const realCotCveArtCol = cotDetCols.find(c => c.toLowerCase() === 'cve_art' || c.toLowerCase() === 'cve_articulo');
              if (realCotCveArtCol && itemSku) rowPairsMap.set(realCotCveArtCol, itemSku);

              const precioEspecialVal = (itemSku ? precioEspecialMap.get(itemSku.toLowerCase()) : undefined) ?? 0.0;

              setIfColExists(rowPairsMap, cotDetCols, 'Cant_Pedida', Number(item.QtyOrdered || item.Qty || 0));
              setIfColExists(rowPairsMap, cotDetCols, 'Cant_Facturar', Number(item.QtyOrdered || item.Qty || 0));
              setIfColExists(rowPairsMap, cotDetCols, 'Cant_Facturada', 0.0);
              setIfColExists(rowPairsMap, cotDetCols, 'Costo_Unitario', Number(item.Price || 0));
              setIfColExists(rowPairsMap, cotDetCols, 'Descuento', Number(item.Discount1 || 0));
              setIfColExists(rowPairsMap, cotDetCols, 'Fech_Captura', todayStr);
              setIfColExists(rowPairsMap, cotDetCols, 'Hora_Captura', timeStr);
              setIfColExists(rowPairsMap, cotDetCols, 'PL_3', precioEspecialVal);
              setIfColExists(rowPairsMap, cotDetCols, 'DescuentoCliente', '');
              setIfColExists(rowPairsMap, cotDetCols, 'FechaEntrega', todayStr);

              const rowPairs = Array.from(rowPairsMap.entries());
              if (rowPairs.length > 0) {
                const rCols = rowPairs.map(([c]) => c);
                const rVals = rowPairs.map(([, v]) => v);
                const rPlaceholders = rCols.map(() => '?').join(', ');
                const rColsSql = rCols.map(c => `\`${c}\``).join(', ');
                await connection.execute(`INSERT IGNORE INTO \`${cotDetTable}\` (${rColsSql}) VALUES (${rPlaceholders})`, rVals);
              }
            }
            console.log(`[WEBHOOK] Renglones de cotización insertados para folio ${nextCotiza}`);
          }
        }
      }

      // B. INSERTAR PEDIDO
      let nextFolio = null;
      let insertResult = null;

      if (cabTable.toLowerCase() === 'cbpedvta') {
        const [ctrlRows] = await connection.execute("SELECT Consec_Num FROM ctrlcons WHERE Tipo = 'NPED' FOR UPDATE");
        if (ctrlRows.length === 0) {
          throw new Error("No se encontró el tipo de consecutivo 'NPED' en la tabla ctrlcons.");
        }
        nextFolio = ctrlRows[0].Consec_Num + 1;

        const realPKCol = cabCols.find(c => c.toLowerCase() === 'no_pedido');
        if (realPKCol) headerPairsMap.set(realPKCol, nextFolio);

        if (nextCotiza) {
          const realCotizCol = cabCols.find(c => c.toLowerCase() === 'cotizacion' || c.toLowerCase() === 'no_cotiza');
          if (realCotizCol) headerPairsMap.set(realCotizCol, nextCotiza);
        }

        const realDistCol = cabCols.find(c => c.toLowerCase() === 'distribuido');
        if (realDistCol) {
          headerPairsMap.set(realDistCol, parseInt(data.StatusId) === 41 ? 0 : 1);
        }

        const headerPairs = Array.from(headerPairsMap.entries());
        if (headerPairs.length === 0) throw new Error('Ningún campo de cabecera mapeado');

        const cols = headerPairs.map(([c]) => c);
        const vals = headerPairs.map(([, v]) => v);
        const placeholders = cols.map(() => '?').join(', ');
        const colsSql = cols.map(c => `\`${c}\``).join(', ');

        const [insertRes] = await connection.execute(`INSERT INTO \`${cabTable}\` (${colsSql}) VALUES (${placeholders})`, vals);
        insertResult = insertRes;

        await connection.execute("UPDATE ctrlcons SET Consec_Num = ? WHERE Tipo = 'NPED'", [nextFolio]);
        console.log(`[WEBHOOK] Pedido insertado con Folio (No_Pedido): ${nextFolio}`);
      } else {
        const realDistCol = cabCols.find(c => c.toLowerCase() === 'distribuido');
        if (realDistCol) {
          headerPairsMap.set(realDistCol, parseInt(data.StatusId) === 41 ? 0 : 1);
        }

        const headerPairs = Array.from(headerPairsMap.entries());
        if (headerPairs.length === 0) throw new Error('Ningún campo de cabecera mapeado');

        const cols = headerPairs.map(([c]) => c);
        const vals = headerPairs.map(([, v]) => v);
        const placeholders = cols.map(() => '?').join(', ');
        const colsSql = cols.map(c => `\`${c}\``).join(', ');

        const [insertRes] = await connection.execute(`INSERT INTO \`${cabTable}\` (${colsSql}) VALUES (${placeholders})`, vals);
        insertResult = insertRes;
        console.log(`[WEBHOOK] Registro insertado en '${cabTable}'`);
      }

      // Renglones del pedido
      if (details.length > 0 && detTable) {
        if (!(await tableExists(detTable))) {
          throw new Error(`Tabla de renglones '${detTable}' no existe`);
        }
        const detCols = await validColumns(detTable);
        let partidaIndex = 1;

        for (const item of details) {
          const rowPairsMap = new Map();

          const realFKCol = detCols.find(c => c.toLowerCase() === 'no_pedido');
          if (realFKCol && (nextFolio || (insertResult && insertResult.insertId))) {
            rowPairsMap.set(realFKCol, nextFolio || insertResult.insertId);
          }

          const realPartidaCol = detCols.find(c => c.toLowerCase() === 'partida');
          if (realPartidaCol) rowPairsMap.set(realPartidaCol, partidaIndex++);

          for (const def of PS_FIELDS_DETALLE) {
            const erpCol = fieldMapDet[def.field];
            if (!erpCol) continue;
            const realCol = detCols.find(c => c.toLowerCase() === erpCol.toLowerCase());
            if (!realCol || realCol === realFKCol || realCol === realPartidaCol) continue;

            const val = def.field === 'OrderNumber' ? (nextFolio || orderNumber) : item[def.field];
            if (val === undefined) continue;
            rowPairsMap.set(realCol, val);
          }

          const itemSku = String(item.ProductId || item.ProductCode || item.SKU || item.product?.SKU || item.product?.ProductCode || '').trim();
          const realCveArtCol = detCols.find(c => c.toLowerCase() === 'cve_articulo' || c.toLowerCase() === 'cve_art');
          if (realCveArtCol && itemSku) rowPairsMap.set(realCveArtCol, itemSku);

          const precioEspecialVal = (itemSku ? precioEspecialMap.get(itemSku.toLowerCase()) : undefined) ?? 0.0;

          setIfColExists(rowPairsMap, detCols, 'Cant_Pedida', Number(item.QtyOrdered || item.Qty || 0));
          setIfColExists(rowPairsMap, detCols, 'Cant_Facturar', Number(item.QtyOrdered || item.Qty || 0));
          setIfColExists(rowPairsMap, detCols, 'Cant_Facturada', 0.0);
          setIfColExists(rowPairsMap, detCols, 'Costo_Unitario', Number(item.Price || 0));
          setIfColExists(rowPairsMap, detCols, 'Descuento', Number(item.Discount1 || 0));
          setIfColExists(rowPairsMap, detCols, 'Fech_Captura', todayStr);
          setIfColExists(rowPairsMap, detCols, 'Hora_Captura', timeStr);
          setIfColExists(rowPairsMap, detCols, 'PL_3', precioEspecialVal);

          const rowPairs = Array.from(rowPairsMap.entries());
          if (rowPairs.length > 0) {
            const rCols = rowPairs.map(([c]) => c);
            const rVals = rowPairs.map(([, v]) => v);
            const rPlaceholders = rCols.map(() => '?').join(', ');
            const rColsSql = rCols.map(c => `\`${c}\``).join(', ');
            await connection.execute(`INSERT IGNORE INTO \`${detTable}\` (${rColsSql}) VALUES (${rPlaceholders})`, rVals);
          }
        }
        console.log(`[WEBHOOK] Pedido ${orderNumber}: ${details.length} renglón(es) insertados en '${detTable}'`);
      }

      await connection.commit();
      await saveWebhookLog('orders', orderNumber, data, 1, null);
    } catch (txErr) {
      await connection.rollback();
      throw txErr;
    } finally {
      connection.release();
    }

  } catch (dbErr) {
    console.error(`[WEBHOOK] Error DB al insertar pedido ${orderNumber}:`, dbErr.message);
    await saveWebhookLog('orders', orderNumber, data, 2, `Error DB al insertar: ${dbErr.message}`);
  }
}

module.exports = { handleProductUpdate, handleCustomerUpdate, handleOrderInsert };
