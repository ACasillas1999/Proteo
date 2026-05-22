'use strict';
const { query }          = require('../db');
const ps                 = require('../powersales');
const { getFieldMapping, getConfig } = require('../localdb');
const catalog            = require('../catalogCache');

/**
 * Lee el mapeo desde proteo_db (field_mapping + app_config).
 * Fallback: valores por defecto si la BD no tiene datos.
 */
async function getMapeo() {
  const fieldMap   = await getFieldMapping('articulo');
  const categories = await getConfig('articulo_categories', {
    MAT: 1, SERV: 2, NLAG: 3, HALB: 4,
    HAWA: 5, FERT: 6, VERP: 7, ROH: 8,
  });
  const defaultCategoryId = await getConfig('articulo_defaultCategoryId', 1);
  return { fieldMap, categories, defaultCategoryId };
}

/**
 * Todos los campos de PowerSales para el endpoint POST /products.
 * type:
 *   'text'    → columna ERP (string)
 *   'number'  → columna ERP (parseFloat)
 *   'boolean' → columna ERP (1/0)
 *   'fixed'   → valor constante, no editable por usuario
 *   'fixedId'   → número entero configurable por usuario (LineId, etc.)
 *   'skuPrefix' → primeros N caracteres del SKU (Clave_Articulo)
 *   'categoryId' → se resuelve por mapa Clasificacion→Id
 */
const PS_FIELDS = [
  { field: 'SKU',             type: 'text',       required: true,  label: 'SKU / Código',           defaultErp: 'Clave_Articulo' },
  { field: 'Name',            type: 'text',       required: true,  label: 'Nombre',                 defaultErp: 'Descripcion' },
  { field: 'ShortName',       type: 'text',       required: true,  label: 'Nombre corto',           defaultErp: 'Descripcion' },
  { field: 'Description',     type: 'text',       required: false, label: 'Descripción',            defaultErp: 'Descripcion' },
  { field: 'DescriptionHTML', type: 'text',       required: false, label: 'Descripción HTML',       defaultErp: 'Descripcion' },
  { field: 'Barcode',         type: 'text',       required: false, label: 'Código de barras 1',     defaultErp: null },
  { field: 'BarCode2',        type: 'text',       required: false, label: 'Código de barras 2',     defaultErp: null },
  { field: 'BarCode3',        type: 'text',       required: false, label: 'Código de barras 3',     defaultErp: null },
  { field: 'Cost',            type: 'numStr',     required: true,  label: 'Costo',                  defaultErp: 'Costo_Ult_Compra' },
  { field: 'IsActive',        type: 'boolean',    required: false, label: 'Activo',                 defaultErp: 'Habilitado' },
  { field: 'UnitsPerBox',     type: 'number',     required: false, label: 'Unidades por caja',      defaultErp: null },
  { field: 'CasePerPallet',   type: 'number',     required: false, label: 'Cajas por palet',        defaultErp: null },
  { field: 'ConversionFactor',type: 'number',     required: false, label: 'Factor de conversión',  defaultErp: 'Conversion' },
  { field: 'ClaveSat',        type: 'text',       required: false, label: 'Clave SAT',             defaultErp: 'IDSAT' },
  { field: 'ProductCode',     type: 'text',       required: false, label: 'Código de producto',    defaultErp: 'Clave_Articulo' },
  { field: 'LoyaltyPct',      type: 'numStr',     required: false, label: '% Lealtad',             defaultErp: null },
  // Campos de catálogo — PS acepta strings: BrandNumber, CategoryNumber, LineNumber
  { field: 'BrandId',       type: 'skuPrefix',  required: true,  label: 'ID Marca (BrandNumber)',      prefixLen: 5 },
  { field: 'SubBrandId',    type: 'fixedId',    required: true,  label: 'ID Sub-marca',                defaultFixed: null, asInteger: true },
  { field: 'LineId',        type: 'erpColumn',  required: true,  label: 'ID Línea (LineNumber)',        defaultErp: 'Linea', fallbackValue: '9999' },
  { field: 'BranchId',      type: 'fixedId',    required: true,  label: 'ID Sucursal',                 defaultFixed: process.env.PS_BRANCH_ID || '1', asInteger: true },
  { field: 'CategoryId',    type: 'erpColumn',  required: true,  label: 'ID Categoría (CategoryNumber)', defaultErp: 'Clasificacion', fallbackValue: '9999' },
  { field: 'SubCategoryId', type: 'erpColumn',  required: true,  label: 'ID Sub-categoría',            defaultErp: null },
  // Mapeables o null si sin mapear
  { field: 'ProductType',   type: 'text',       required: false, label: 'Tipo de producto',            defaultErp: null },
  { field: 'IsPMRequired',  type: 'boolean',    required: false, label: 'PM requerido',                defaultErp: null },
  { field: 'IsDecimal',     type: 'boolean',    required: false, label: 'Es decimal',                  defaultErp: null },
];

async function mapArticulo(row) {
  const m = await getMapeo();
  const fieldMap = m.fieldMap ?? {};
  const clasificacion = (row.Clasificacion ?? '').trim().toUpperCase();
  const categoryId    = (m.categories?.[clasificacion]) ?? m.defaultCategoryId ?? 1;

  const payload = {};

  for (const def of PS_FIELDS) {
    const { field, type, defaultErp, defaultFixed, fixedValue } = def;

    if (type === 'fixed') {
      payload[field] = fixedValue;
    } else if (type === 'skuPrefix') {
      // Primeros N chars del SKU → BrandNumber (string)
      const sku = String(row['Clave_Articulo'] ?? '');
      const override = fieldMap[field]; // override manual si el usuario lo mapeó
      payload[field] = override ? String(row[override] ?? '') : sku.substring(0, def.prefixLen ?? 5);
    } else if (type === 'erpColumn') {
      // Lee columna ERP; usa defaultErp si el usuario no mapeó manualmente
      const erpCol = (fieldMap[field] !== undefined && fieldMap[field] !== null && fieldMap[field] !== '')
        ? fieldMap[field]
        : def.defaultErp;
      const rawVal = erpCol ? String(row[erpCol] ?? '').trim() || null : null;
      const isFallback = rawVal === null || rawVal === '0';
      payload[field] = isFallback ? (def.fallbackValue ?? null) : rawVal;
    } else if (type === 'fixedId') {
      const val = fieldMap[field];
      if (val !== undefined && val !== null) {
        const asInt = parseInt(val);
        if (!isNaN(asInt)) {
          // Número fijo
          payload[field] = def.asInteger ? asInt : String(asInt);
        } else {
          // Nombre de columna ERP → leer valor
          const raw = row[val] ?? '';
          const rawInt = parseInt(raw);
          if (def.asInteger) {
            payload[field] = !isNaN(rawInt) ? rawInt : null; // int o null si no es número
          } else {
            payload[field] = String(raw);
          }
        }
      } else {
        payload[field] = null;
      }
    } else if (type === 'categoryId') {
      const val = fieldMap[field];
      if (val !== undefined && val !== null) {
        const asInt = parseInt(val);
        if (!isNaN(asInt)) {
          payload[field] = def.asInteger ? asInt : String(asInt);
        } else {
          // Nombre de columna ERP → leer valor directo
          const raw = String(row[val] ?? '');
          if (def.asInteger) {
            const rawInt = parseInt(raw);
            payload[field] = !isNaN(rawInt) ? rawInt : null;
          } else {
            payload[field] = raw; // string tal cual (ej. CategoryId)
          }
        }
      } else {
        payload[field] = null;
      }
    } else {
      // text | number | boolean | numStr → leer columna ERP
      const erpCol = fieldMap[field] !== undefined ? fieldMap[field] : defaultErp;
      if (!erpCol) {
        payload[field] = null;  // sin mapear → null
        continue;
      }
      const raw = row[erpCol] ?? '';
      if (type === 'number')       payload[field] = parseFloat(raw) || 0;
      else if (type === 'numStr')  payload[field] = String(parseFloat(raw) || 0); // número como string
      else if (type === 'boolean') payload[field] = raw ? 1 : 0;
      else                          payload[field] = String(raw);
    }
  }

  return payload;
}

async function sync(cambio) {
  const { clave_registro } = cambio;
  const [rows] = await query(
    'SELECT * FROM articulo WHERE Clave_Articulo = ? LIMIT 1',
    [clave_registro]
  );
  if (!rows.length) throw new Error(`Artículo '${clave_registro}' no encontrado en ERP`);

  const payload = await mapArticulo(rows[0]);

  // PowerSales solo acepta POST para crear/actualizar productos
  await ps.post('/products', { data: [payload] });

  return payload;
}

module.exports = { sync, mapArticulo, PS_FIELDS };
