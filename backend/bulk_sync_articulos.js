'use strict';
require('dotenv').config();

const { query: erpQuery } = require('./src/db');
const { getFieldMapping, getConfig } = require('./src/localdb');
const ps = require('./src/powersales');
const { PS_FIELDS } = require('./src/handlers/articulo');

if (!process.env.PS_BASE_URL) {
  throw new Error('PS_BASE_URL no está definida en el archivo .env');
}

/**
 * Mapea una fila de artículo en memoria basándose en la configuración mapeada.
 * Esta versión está optimizada para ejecutarse en memoria síncronamente sin consultas a base de datos.
 */
function mapArticuloLocal(row, mapeoConfig) {
  const { fieldMap, categories, defaultCategoryId } = mapeoConfig;
  const clasificacion = (row.Clasificacion ?? '').trim().toUpperCase();
  const categoryId    = (categories?.[clasificacion]) ?? defaultCategoryId ?? 1;

  const payload = {};
  const priceListsMapped = {};

  for (const def of PS_FIELDS) {
    const { field, type, defaultErp, defaultFixed, fixedValue } = def;

    if (type === 'priceList') {
      const erpCol = fieldMap[field] !== undefined ? fieldMap[field] : defaultErp;
      const raw = erpCol ? (row[erpCol] ?? '') : '';
      priceListsMapped[def.listName] = parseFloat(raw) || 0;
      continue;
    }

    if (type === 'fixed') {
      payload[field] = fixedValue;
    } else if (type === 'skuPrefix') {
      const sku = String(row['Clave_Articulo'] ?? '');
      const override = fieldMap[field];
      payload[field] = override ? String(row[override] ?? '') : sku.substring(0, def.prefixLen ?? 5);
    } else if (type === 'erpColumn') {
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
          payload[field] = def.asInteger ? asInt : String(asInt);
        } else {
          const raw = row[val] ?? '';
          const rawInt = parseInt(raw);
          if (def.asInteger) {
            payload[field] = !isNaN(rawInt) ? rawInt : null;
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
          const raw = String(row[val] ?? '');
          if (def.asInteger) {
            const rawInt = parseInt(raw);
            payload[field] = !isNaN(rawInt) ? rawInt : null;
          } else {
            payload[field] = raw;
          }
        }
      } else {
        payload[field] = null;
      }
    } else {
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

  // Sobrescribir CategoryId específico según la clasificación lógica original
  payload['CategoryId'] = categoryId;

  return { payload, priceListsMapped };
}

(async () => {
  console.log('=== INICIANDO HERRAMIENTA DE SINCRONIZACIÓN MASIVA DE ARTÍCULOS ===\n');
  console.log(`ERP Host de Origen: ${process.env.MYSQL_HOST || 'localhost'}`);
  console.log(`ERP Base de Datos:  ${process.env.MYSQL_DB || ''}\n`);

  try {
    // 1. Cargar la configuración de mapeos locales de proteo_db una sola vez
    console.log('[BULK] Cargando mapeos de base de datos local...');
    const fieldMap = await getFieldMapping('articulo');
    const categories = await getConfig('articulo_categories', {
      MAT: 1, SERV: 2, NLAG: 3, HALB: 4, HAWA: 5, FERT: 6, VERP: 7, ROH: 8,
    });
    const defaultCategoryId = await getConfig('articulo_defaultCategoryId', 1);
    const mapeoConfig = { fieldMap, categories, defaultCategoryId };
    console.log('[BULK] ✓ Mapeos cargados correctamente.');

    // 2. Obtener la cantidad total de artículos en el ERP de origen
    const [countRows] = await erpQuery('SELECT COUNT(*) as total FROM articulo');
    const total = countRows[0].total;
    console.log(`[BULK] Total de artículos a procesar en el ERP: ${total}`);

    if (total === 0) {
      console.log('[BULK] No hay artículos para procesar. Finalizando.');
      process.exit(0);
    }

    const BATCH_SIZE = 1000;
    let offset = 0;

    // 3. Procesar en lotes (de 1,000 en 1,000)
    while (offset < total) {
      console.log(`\n[BULK] Procesando lote: [${offset} a ${Math.min(offset + BATCH_SIZE, total)}] ...`);
      
      const [rows] = await erpQuery(
        'SELECT * FROM articulo ORDER BY Clave_Articulo ASC LIMIT ? OFFSET ?',
        [BATCH_SIZE, offset]
      );
      
      if (!rows.length) {
        console.log('[BULK] Lote vacío recibido, terminando bucle.');
        break;
      }

      const batchProducts = [];
      const batchPriceDetails = [];
      const uniquePriceLists = new Set();

      // Mapear los registros en memoria a velocidades extremadamente altas
      for (const row of rows) {
        const { payload, priceListsMapped } = mapArticuloLocal(row, mapeoConfig);
        batchProducts.push(payload);

        // Agrupar los detalles de listas de precios
        const costVal = parseFloat(row['Costo_Ult_Compra']) || 0;
        Object.entries(priceListsMapped).forEach(([pl, priceVal]) => {
          uniquePriceLists.add(pl);
          batchPriceDetails.push({
            ProductId: String(row['Clave_Articulo'] ?? ''),
            PriceListId: pl,
            Cost: String(costVal),
            Price: String(priceVal),
            IsActive: 1
          });
        });
      }

      // Enviar el lote a la API de PowerSales
      try {
        console.log(`[BULK] Enviando ${batchProducts.length} productos a /products...`);
        await ps.post('/products', { data: batchProducts });
        console.log('[BULK] ✓ Productos enviados.');

        if (batchPriceDetails.length > 0) {
          // Asegurar que las listas de precios estén registradas (Catálogo)
          const plData = Array.from(uniquePriceLists).map(pl => ({
            Name: pl,
            IsActive: 1,
            IsDefault: 0,
            PriceListNumber: pl
          }));

          console.log(`[BULK] Registrando ${plData.length} listas de precios en /pricelists...`);
          await ps.post('/pricelists', { data: plData });

          console.log(`[BULK] Enviando ${batchPriceDetails.length} precios a /pricelistsdetails...`);
          await ps.post('/pricelistsdetails', { data: batchPriceDetails });
          console.log('[BULK] ✓ Precios enviados.');
        }

        console.log(`[BULK] Lote completado exitosamente: (${offset + batchProducts.length} / ${total})`);
      } catch (apiErr) {
        console.error(`[BULK] ✗ Error de API en el lote del OFFSET ${offset}:`, apiErr.message);
        console.log('[BULK] Continuando con el siguiente lote...');
      }

      offset += BATCH_SIZE;
    }

    console.log('\n==================================================================');
    console.log('🎉 Sincronización masiva inicial finalizada con éxito.');
    console.log('==================================================================');

  } catch (err) {
    console.error('\n[BULK] ✗ Error crítico durante el proceso:', err.message);
  } finally {
    process.exit(0);
  }
})();
