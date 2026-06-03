'use strict';
const { query }           = require('../db');
const ps                  = require('../powersales');
const { getFieldMapping } = require('../localdb');

/**
 * Lee el mapeo desde proteo_db.
 */
async function getMapeo() {
  const fieldMap = await getFieldMapping('cliente');
  return { fieldMap };
}

/**
 * Todos los campos de PowerSales para el endpoint POST /customers.
 * type:
 *   'text'      → columna ERP (string)
 *   'number'    → columna ERP (parseFloat)
 *   'numStr'    → columna ERP (número como string)
 *   'boolean'   → columna ERP (1/0)
 *   'fixedId'   → valor fijo configurable por usuario
 *   'erpColumn' → columna ERP (string, con fallback)
 */
const PS_FIELDS = [
  // ── Identificación ──
  { field: 'CustomerNumber',            type: 'erpColumn', required: true,  label: 'Número de Cliente',           defaultErp: 'Cliente' },
  { field: 'Name',                      type: 'text',      required: true,  label: 'Nombre / Razón Social',       defaultErp: 'Razon_Social' },
  { field: 'Email',                     type: 'text',      required: false, label: 'Email',                       defaultErp: null },
  { field: 'InvoiceName',              type: 'text',      required: false, label: 'Razón Social (Facturación)',  defaultErp: 'Razon_Social' },
  { field: 'TIN',                       type: 'text',      required: false, label: 'RFC / Tax ID',                defaultErp: 'RFC' },

  // ── Dirección ──
  { field: 'Address1',                  type: 'text',      required: false, label: 'Dirección 1 (Calle)',         defaultErp: 'Calle' },
  { field: 'Address2',                  type: 'text',      required: false, label: 'Dirección 2 (Colonia)',       defaultErp: 'Colonia' },
  { field: 'LeftStreet',               type: 'text',      required: false, label: 'Entre calle (izq)',           defaultErp: null },
  { field: 'RightStreet',             type: 'text',      required: false, label: 'Entre calle (der)',           defaultErp: null },
  { field: 'Latitude',                 type: 'text',      required: false, label: 'Latitud',                     defaultErp: null },
  { field: 'Longitude',                type: 'text',      required: false, label: 'Longitud',                    defaultErp: null },

  // ── Estado ──
  { field: 'IsActive',                 type: 'boolean',   required: false, label: 'Activo',                      defaultErp: 'Status' },
  { field: 'StateId',                  type: 'erpColumn', required: false, label: 'Estado (StateId)',            defaultErp: null },
  { field: 'CityId',                   type: 'erpColumn', required: false, label: 'Ciudad (CityId)',            defaultErp: 'Ciudad' },
  { field: 'LocationId',              type: 'erpColumn', required: false, label: 'Localidad (LocationId)',     defaultErp: 'Ubicacion' },

  // ── Sucursal y Ruta ──
  { field: 'BranchId',                 type: 'fixedId',   required: true,  label: 'ID Sucursal',                 defaultFixed: process.env.PS_BRANCH_ID || '1', asInteger: true },
  { field: 'RouteId',                  type: 'number',    required: false, label: 'ID Ruta',                     defaultErp: null },
  { field: 'RouteNumber',             type: 'number',    required: false, label: 'Número de Ruta',             defaultErp: null },

  // ── Clasificación ──
  { field: 'CustomerTypeId',           type: 'erpColumn', required: false, label: 'Tipo de Cliente',             defaultErp: null },
  { field: 'CustomerClassificationId', type: 'number',    required: false, label: 'Clasificación de Cliente',   defaultErp: 'Clasificacion' },

  // ── Precios y Crédito ──
  { field: 'PriceListId',             type: 'number',    required: false, label: 'ID Lista de Precios',         defaultErp: null },
  { field: 'PriceListNumber',         type: 'erpColumn', required: false, label: 'Número Lista de Precios',    defaultErp: null },
  { field: 'IsCredit',                type: 'boolean',   required: false, label: 'Tiene Crédito',              defaultErp: 'OtorgoCredito' },
  { field: 'CreditLimit',             type: 'numStr',    required: false, label: 'Límite de Crédito',          defaultErp: 'Limite_Credito' },
  { field: 'AccountBalance',          type: 'numStr',    required: false, label: 'Saldo de Cuenta',            defaultErp: 'Saldo_Actual' },

  // ── Flags ──
  { field: 'IsProspect',              type: 'boolean',   required: false, label: 'Es Prospecto',               defaultErp: null },
  { field: 'IsPOMandatory',           type: 'boolean',   required: false, label: 'OC Obligatoria',             defaultErp: null },
  { field: 'IsSignatureMandatory',    type: 'boolean',   required: false, label: 'Firma Obligatoria',          defaultErp: null },
  { field: 'IsTop10Enabled',          type: 'boolean',   required: false, label: 'Top 10 Habilitado',          defaultErp: null },
  { field: 'IsPriorityEnabled',       type: 'boolean',   required: false, label: 'Prioridad Habilitada',       defaultErp: null },
  { field: 'IsEarlyOrderEnabled',     type: 'boolean',   required: false, label: 'Pedido Anticipado',          defaultErp: null },

  // ── Contacto ──
  { field: 'UniqueId',                type: 'text',      required: false, label: 'ID Único',                    defaultErp: null },
  { field: 'DayOffSet',               type: 'number',    required: false, label: 'Días de Offset',             defaultErp: null },
  { field: 'Telephone',               type: 'text',      required: false, label: 'Teléfono',                   defaultErp: 'Telefono1' },
  { field: 'Cellphone',               type: 'text',      required: false, label: 'Celular',                    defaultErp: null },

  // ── Otros ──
  { field: 'DefaultPaymentTypeId',    type: 'number',    required: false, label: 'Tipo de Pago por Defecto',   defaultErp: null },
  { field: 'CallDay',                 type: 'number',    required: false, label: 'Día de Llamada',             defaultErp: null },
  { field: 'ChannelId',               type: 'number',    required: false, label: 'ID Canal',                    defaultErp: null },
  { field: 'BannerId',                type: 'number',    required: false, label: 'ID Banner',                   defaultErp: null },
  { field: 'ParentCustomerId',        type: 'number',    required: false, label: 'ID Cliente Padre',           defaultErp: null },
  { field: 'Top10Id',                 type: 'number',    required: false, label: 'ID Top 10',                   defaultErp: null },
  { field: 'ProductListsId',          type: 'number',    required: false, label: 'ID Lista de Productos',      defaultErp: null },
];

async function mapCliente(row) {
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
    } else {
      // text | number | boolean | numStr
      const erpCol = fieldMap[field] !== undefined ? fieldMap[field] : defaultErp;
      if (!erpCol) {
        payload[field] = null;
        continue;
      }
      const raw = row[erpCol] ?? '';
      if (type === 'number')       payload[field] = parseFloat(raw) || 0;
      else if (type === 'numStr')  payload[field] = String(parseFloat(raw) || 0);
      else if (type === 'boolean') payload[field] = raw ? 1 : 0;
      else                          payload[field] = String(raw);
    }
  }

  return payload;
}

async function sync(cambio) {
  const { clave_registro } = cambio;

  // PK de la tabla clientes es "Cliente" (int)
  const [rows] = await query(
    'SELECT * FROM clientes WHERE Cliente = ? LIMIT 1',
    [clave_registro]
  );
  if (!rows.length) throw new Error(`Cliente '${clave_registro}' no encontrado en ERP`);

  const payload = await mapCliente(rows[0]);

  // PowerSales: POST /customers
  await ps.post('/customers', { data: [payload] });

  return payload;
}

module.exports = { sync, mapCliente, PS_FIELDS };
