'use strict';
const { query }          = require('../db');
const ps                 = require('../powersales');
const { getFieldMapping, getConfig } = require('../localdb');
const catalog            = require('../catalogCache');

// Caché en memoria para evitar registrar las mismas listas de precios repetidamente
const registeredPriceLists = new Set();

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
  { field: 'UnitsPerBox',     type: 'number',     required: false, label: 'Unidades por caja',      defaultErp: null, fallbackValue: 1 },
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
  { field: 'ProductType',   type: 'text',       required: false, label: 'Tipo de producto',            defaultErp: null, fallbackValue: 'P' },
  { field: 'IsPMRequired',  type: 'boolean',    required: false, label: 'PM requerido',                defaultErp: null },
  { field: 'IsDecimal',     type: 'boolean',    required: false, label: 'Es decimal',                  defaultErp: null },
  // Listas de precios (no van a /products, sino a /pricelistsdetails)
  { field: 'PL_Precio_Lista',    type: 'priceList',  required: false, label: 'Precio_Lista (Lista 1)',     defaultErp: 'Precio_Lista',    listName: 'Precio_Lista' },
  { field: 'PL_Precio_Venta',    type: 'priceList',  required: false, label: 'Precio_Venta (Lista 2)',     defaultErp: 'Precio_Venta',    listName: 'Precio_Venta' },
  { field: 'PL_Precio_Especial', type: 'priceList',  required: false, label: 'Precio_Especial (Lista 3)',  defaultErp: 'Precio_Especial', listName: 'Precio_Especial' },
  { field: 'PL_Precio4',         type: 'priceList',  required: false, label: 'Precio4 (Lista 4)',          defaultErp: 'Precio4',         listName: 'Precio4' },
  // Listas de descuentos (no van a /products, sino a /discountlistdetails)
  { field: 'DL_Desc_Precio_Venta',   type: 'discountList',      listId: 1, required: false, label: 'Lista Descto 1 — Desc_Precio_Venta (% Venta)',    defaultErp: null },
  { field: 'DL_Desc_Precio_Espec',   type: 'discountList',      listId: 2, required: false, label: 'Lista Descto 2 — Desc_Precio_Espec (% Especial)', defaultErp: null },
  { field: 'DL_Desc_Precio4',        type: 'discountList',      listId: 3, required: false, label: 'Lista Descto 3 — Desc_Precio4 (% Lista 4)',         defaultErp: null },
  { field: 'DL_Desc_Proveedor',      type: 'discountList',      listId: 4, required: false, label: 'Lista Descto 4 — Desc_Proveedor (% Gerente)',       defaultErp: null },
  { field: 'DL_PorcentajeDescuento', type: 'discountList',      listId: 5, required: false, label: 'Lista Descto 5 — PorcentajeDescuento (% Pricing)',  defaultErp: null },
  { field: 'DL_Encargado_Pricing',   type: 'discountListFixed', listId: 6, required: false, label: 'Lista Descto 6 — Encargado Pricing (100% Fijo)',    fixedValue: '100.00' },
];

async function mapArticulo(row) {
  const m = await getMapeo();
  const fieldMap = m.fieldMap ?? {};
  const clasificacion = (row.Clasificacion ?? '').trim().toUpperCase();
  const categoryId    = (m.categories?.[clasificacion]) ?? m.defaultCategoryId ?? 1;

  const payload = {};
  const priceListsMapped = {};

  for (const def of PS_FIELDS) {
    const { field, type, defaultErp, defaultFixed, fixedValue } = def;

    if (type === 'priceList' || type === 'discountList' || type === 'discountListFixed') {
      if (type === 'priceList') {
        const erpCol = fieldMap[field] !== undefined ? fieldMap[field] : defaultErp;
        const raw = erpCol ? (row[erpCol] ?? '') : '';
        priceListsMapped[def.listName] = parseFloat(raw) || 0;
      }
      continue;
    }

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
      const val = fieldMap[field] ?? defaultFixed;
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
        if (type === 'boolean') {
          payload[field] = def.fallbackValue !== undefined ? def.fallbackValue : 0;
        } else if (type === 'number') {
          payload[field] = def.fallbackValue !== undefined ? def.fallbackValue : 0;
        } else if (type === 'numStr') {
          payload[field] = def.fallbackValue !== undefined ? String(def.fallbackValue) : '0';
        } else {
          payload[field] = def.fallbackValue !== undefined ? def.fallbackValue : null;
        }
        continue;
      }
      const raw = row[erpCol] ?? '';
      if (type === 'number')       payload[field] = parseFloat(raw) || 0;
      else if (type === 'numStr')  payload[field] = String(parseFloat(raw) || 0); // número como string
      else if (type === 'boolean') payload[field] = raw ? 1 : 0;
      else                          payload[field] = String(raw);
    }
  }

  // Sobrescribir CategoryId específico según la clasificación lógica original
  payload['CategoryId'] = categoryId;

  return { payload, priceListsMapped, fieldMap: m.fieldMap };
}

async function sync(cambio) {
  const { clave_registro } = cambio;
  const [rows] = await query(
    'SELECT * FROM articulo WHERE Clave_Articulo = ? LIMIT 1',
    [clave_registro]
  );
  if (!rows.length) throw new Error(`Artículo '${clave_registro}' no encontrado en ERP`);

  const row = rows[0];
  const mapped = await mapArticulo(row);
  
  // Compatibilidad con si alguien llama a mapArticulo esperando solo payload (aunque aquí usamos el objeto)
  const payload = mapped.payload ?? mapped;
  const priceListsMapped = mapped.priceListsMapped ?? {};
  const fieldMapObj = mapped.fieldMap ?? {};

  // PowerSales solo acepta POST para crear/actualizar productos
  await ps.post('/products', { data: [payload] });

  // 1. Armar y enviar el catálogo de listas de precios (headers) - Optimizado con caché en memoria
  const priceListsNames = Object.keys(priceListsMapped);
  if (priceListsNames.length > 0) {
    const priceListsToRegister = priceListsNames.filter(pl => !registeredPriceLists.has(pl));
    if (priceListsToRegister.length > 0) {
      const plData = priceListsToRegister.map(pl => ({
        Name: pl,
        IsActive: 1,
        IsDefault: 0,
        PriceListNumber: pl
      }));
      await ps.post('/pricelists', { data: plData });
      priceListsToRegister.forEach(pl => registeredPriceLists.add(pl));
    }

    // 2. Armar y enviar los detalles de precios para este artículo
    const costVal = parseFloat(row['Costo_Ult_Compra']) || 0;
    const pldData = Object.entries(priceListsMapped).map(([pl, priceVal]) => {
      return {
        ProductId: String(row['Clave_Articulo'] ?? ''),
        PriceListId: pl,
        Cost: String(costVal),
        Price: String(priceVal),
        IsActive: 1
      };
    });
    await ps.post('/pricelistsdetails', { data: pldData });
  }

  // 3. Armar y enviar los detalles de 6 listas de descuentos para este artículo
  const skuVal = String(row['Clave_Articulo'] ?? '').trim();

  const getDiscVal = (fieldKey, defaultErpCol = null) => {
    const erpCol = (fieldMapObj[fieldKey] !== undefined && fieldMapObj[fieldKey] !== null && fieldMapObj[fieldKey] !== '')
      ? fieldMapObj[fieldKey]
      : defaultErpCol;

    let rawVal = 0;
    if (erpCol && row[erpCol] !== undefined && row[erpCol] !== null) {
      rawVal = row[erpCol];
    } else if (erpCol) {
      const foundKey = Object.keys(row).find(k => k.toLowerCase() === String(erpCol).toLowerCase());
      if (foundKey) rawVal = row[foundKey];
    }
    return (parseFloat(rawVal) || 0).toFixed(2);
  };

  const discountDetailsData = [
    {
      DiscountListId: 1,
      ProductId: skuVal,
      RangeMin: "1",
      RangeMax: "9999",
      Discount: getDiscVal('DL_Desc_Precio_Venta', null),
      DiscountAppliedTo: "1",
      Type: "%",
      IsActive: 1,
      ExternalReference: "1"
    },
    {
      DiscountListId: 2,
      ProductId: skuVal,
      RangeMin: "1",
      RangeMax: "9999",
      Discount: getDiscVal('DL_Desc_Precio_Espec', null),
      DiscountAppliedTo: "1",
      Type: "%",
      IsActive: 1,
      ExternalReference: "1"
    },
    {
      DiscountListId: 3,
      ProductId: skuVal,
      RangeMin: "1",
      RangeMax: "9999",
      Discount: getDiscVal('DL_Desc_Precio4', null),
      DiscountAppliedTo: "1",
      Type: "%",
      IsActive: 1,
      ExternalReference: "1"
    },
    {
      DiscountListId: 4,
      ProductId: skuVal,
      RangeMin: "1",
      RangeMax: "9999",
      Discount: getDiscVal('DL_Desc_Proveedor', null),
      DiscountAppliedTo: "1",
      Type: "%",
      IsActive: 1,
      ExternalReference: "1"
    },
    {
      DiscountListId: 5,
      ProductId: skuVal,
      RangeMin: "1",
      RangeMax: "9999",
      Discount: getDiscVal('DL_PorcentajeDescuento', null),
      DiscountAppliedTo: "1",
      Type: "%",
      IsActive: 1,
      ExternalReference: "1"
    },
    {
      DiscountListId: 6,
      ProductId: skuVal,
      RangeMin: "1",
      RangeMax: "9999",
      Discount: "100.00",
      DiscountAppliedTo: "1",
      Type: "%",
      IsActive: 1,
      ExternalReference: "1"
    }
  ];

  try {
    await ps.post('/discountlistdetails', { data: discountDetailsData });
    console.log(`[SYNC ARTICULO] 6 Listas de Descuentos enviadas exitosamente a PowerSales para el SKU: ${skuVal}`);
  } catch (discErr) {
    try {
      await ps.post('/discountlistdetail', { data: discountDetailsData });
      console.log(`[SYNC ARTICULO] 6 Listas de Descuentos enviadas exitosamente (/discountlistdetail) para el SKU: ${skuVal}`);
    } catch (err2) {
      console.error('[SYNC ARTICULO] Error al enviar listas de descuentos a PowerSales:', discErr.message);
    }
  }

  return { product: payload, priceListsDetails: mapped.priceListsMapped, discountListsDetails: discountDetailsData };
}

module.exports = { sync, mapArticulo, PS_FIELDS };
