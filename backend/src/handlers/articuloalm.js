'use strict';
const { query }          = require('../db');
const ps                 = require('../powersales');
const { getFieldMapping } = require('../localdb');

/**
 * Lee el mapeo desde proteo_db.
 */
async function getMapeo() {
  const fieldMap = await getFieldMapping('articuloalm');
  return { fieldMap };
}

/**
 * Campos para el endpoint POST /warehouseinventory
 */
const PS_FIELDS = [
  { field: 'ProductId',             type: 'erpColumn', required: true,  label: 'SKU (Va en ProductId)',        defaultErp: 'Clave_Articulo' },
  { field: 'WarehouseId',           type: 'erpColumn', required: true,  label: 'Almacén (Va en WarehouseId)',  defaultErp: 'Almacen' },
  { field: 'BranchId',              type: 'fixedId',   required: true,  label: 'ID Sucursal',                  defaultFixed: process.env.PS_BRANCH_ID || '1', asInteger: true },
  
  { field: 'InventoryAvailable',    type: 'number',    required: false, label: 'Inventario Disponible',        defaultErp: 'Existencia_Fisica' },
  { field: 'InventoryNotAvailable', type: 'number',    required: false, label: 'Inventario Apartado',          defaultErp: 'Apartado' },
  { field: 'InventoryTransitIn',    type: 'number',    required: false, label: 'Inventario en Tránsito',       defaultErp: 'PendientedeEntrega' },
  { field: 'InventoryTransitOut',   type: 'number',    required: false, label: 'Inventario Tránsito Salida',   defaultErp: null },
];

async function mapArticuloalm(row) {
  const m = await getMapeo();
  const fieldMap = m.fieldMap ?? {};

  const payload = {};

  for (const def of PS_FIELDS) {
    const { field, type, defaultErp, defaultFixed } = def;

    if (type === 'fixedId') {
      const val = fieldMap[field] ?? defaultFixed;
      if (val !== undefined && val !== null) {
        const asInt = parseInt(val);
        if (!isNaN(asInt)) {
          payload[field] = def.asInteger ? asInt : String(asInt);
        } else {
          const raw = String(row[val] ?? '');
          payload[field] = def.asInteger ? parseInt(raw) || null : raw;
        }
      } else {
        payload[field] = null;
      }
    } else if (type === 'erpColumn') {
      const erpCol = (fieldMap[field] !== undefined && fieldMap[field] !== null && fieldMap[field] !== '')
        ? fieldMap[field]
        : defaultErp;
      payload[field] = erpCol ? String(row[erpCol] ?? '').trim() || null : null;
    } else if (type === 'number') {
      const erpCol = fieldMap[field] !== undefined ? fieldMap[field] : defaultErp;
      if (!erpCol) {
        payload[field] = 0;
        continue;
      }
      payload[field] = parseFloat(row[erpCol]) || 0;
    }
  }

  return payload;
}

async function sync(cambio) {
  const { clave_registro } = cambio;
  
  // clave_registro en magic generalmente es PK compuesto o solo el ID
  // Asumiremos que si nos llega, podemos buscar por Clave_Articulo o tenemos que procesar toda la tabla.
  // En Proteo normalmente se extrae la info de la tabla
  // Si la clave tiene formato especial (ej: ARTICULO|ALMACEN) hay que separarlo, 
  // pero buscaremos todos los almacenes de ese artículo.
  
  const partes = String(clave_registro).split('|');
  const claveArticulo = partes[0];
  const almacen = partes.length > 1 ? partes[1] : null;

  let queryStr = 'SELECT * FROM articuloalm WHERE Clave_Articulo = ?';
  let params = [claveArticulo];

  if (almacen) {
    queryStr += ' AND Almacen = ?';
    params.push(almacen);
  }

  const [rows] = await query(queryStr, params);
  
  if (!rows.length) throw new Error(`Inventario para '${clave_registro}' no encontrado en ERP`);

  const dataArr = [];
  for (const row of rows) {
    const payload = await mapArticuloalm(row);
    dataArr.push(payload);
  }

  // PowerSales espera formato: { data: [ { ... } ] }
  await ps.post('/warehouseinventory', { data: dataArr });

  return dataArr;
}

module.exports = { sync, mapArticuloalm, PS_FIELDS };
