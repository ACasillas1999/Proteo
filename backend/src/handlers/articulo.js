'use strict';
const { query }          = require('../db');
const ps                 = require('../powersales');
const { getFieldMapping, getConfig } = require('../localdb');

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
  { field: 'Cost',            type: 'number',     required: true,  label: 'Costo',                  defaultErp: 'Costo_Ult_Compra' },
  { field: 'IsActive',        type: 'boolean',    required: false, label: 'Activo',                 defaultErp: 'Habilitado' },
  { field: 'UnitsPerBox',     type: 'number',     required: false, label: 'Unidades por caja',      defaultErp: null },
  { field: 'CasePerPallet',   type: 'number',     required: false, label: 'Cajas por palet',        defaultErp: null },
  { field: 'ConversionFactor',type: 'number',     required: false, label: 'Factor de conversión',  defaultErp: 'Conversion' },
  { field: 'ClaveSat',        type: 'text',       required: false, label: 'Clave SAT',             defaultErp: 'IDSAT' },
  { field: 'ProductCode',     type: 'text',       required: false, label: 'Código de producto',    defaultErp: 'Clave_Articulo' },
  { field: 'LoyaltyPct',      type: 'number',     required: false, label: '% Lealtad',             defaultErp: null },
  // Campos de catálogo — ID numérico fijo o mapeado
  { field: 'BrandId',         type: 'skuPrefix',  required: true,  label: 'ID Marca (línea SKU)', prefixLen: 5 },
  { field: 'SubBrandId',      type: 'fixedId',    required: true,  label: 'ID Sub-marca',          defaultFixed: 1 },
  { field: 'LineId',          type: 'fixedId',    required: true,  label: 'ID Línea',              defaultFixed: 1 },
  { field: 'BranchId',        type: 'fixedId',    required: true,  label: 'ID Sucursal',           defaultFixed: 1 },
  { field: 'CategoryId',      type: 'categoryId', required: true,  label: 'ID Categoría',          defaultFixed: 1 },
  { field: 'SubCategoryId',   type: 'categoryId', required: true,  label: 'ID Sub-categoría',      defaultFixed: 1 },
  // Fijos del sistema
  { field: 'ProductType',     type: 'fixed',      required: false, label: 'Tipo de producto',      fixedValue: 'N' },
  { field: 'IsPMRequired',    type: 'fixed',      required: false, label: 'PM requerido',          fixedValue: 0 },
  { field: 'IsDecimal',       type: 'fixed',      required: false, label: 'Es decimal',            fixedValue: 0 },
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
      // Toma los primeros N caracteres del SKU como valor del campo
      const sku = String(row['Clave_Articulo'] ?? '');
      const len = def.prefixLen ?? 5;
      payload[field] = sku.substring(0, len);
    } else if (type === 'fixedId') {
      // El usuario puede haber sobreescrito el ID en fieldMap como número
      const val = fieldMap[field];
      payload[field] = val !== undefined ? parseInt(val) : (defaultFixed ?? 1);
    } else if (type === 'categoryId') {
      payload[field] = categoryId;
    } else {
      // text | number | boolean → leer columna ERP
      const erpCol = fieldMap[field] !== undefined ? fieldMap[field] : defaultErp;
      if (!erpCol) {
        payload[field] = type === 'number' ? 0 : '';
        continue;
      }
      const raw = row[erpCol] ?? '';
      if (type === 'number')       payload[field] = parseFloat(raw) || 0;
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

  let exists = false;
  try {
    await ps.get(`/products/${encodeURIComponent(clave_registro)}`);
    exists = true;
  } catch { exists = false; }

  if (exists) {
    // En lugar de enviar a /products/{sku} que puede causar un bug de actualización masiva en PowerSales
    // si el SKU tiene diagonales (%2F) o si todos los IDs son 0, enviamos al endpoint general en formato array.
    await ps.put('/products', { data: [payload] });
  } else {
    await ps.post('/products', { data: [payload] });
  }
}

module.exports = { sync, mapArticulo, PS_FIELDS };
