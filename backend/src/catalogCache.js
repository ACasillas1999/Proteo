'use strict';
/**
 * catalogCache.js
 * Descarga y cachea los catálogos de PowerSales en memoria.
 * Provee lookups: BrandNumber → Id, CategoryNumber → Id, LineNumber → Id
 * Se refresca automáticamente cada REFRESH_MS ms (default 1h).
 */
const ps = require('./powersales');

const REFRESH_MS = 60 * 60 * 1000; // 1 hora

let cache = null;
let lastFetch = 0;

/** Descarga todas las páginas de un endpoint paginado de PS */
async function fetchAll(endpoint) {
  const items = [];
  let page = 1;
  while (true) {
    const r = await ps.get(`/${endpoint}`, { params: { page } });
    const data = r.data?.data ?? [];
    items.push(...data);
    const meta = r.data?.meta ?? {};
    if (page >= (meta.last_page ?? 1)) break;
    page++;
  }
  return items;
}

async function buildCache() {
  console.log('[catalogCache] Descargando catálogos de PowerSales…');
  const [brands, categories, lines] = await Promise.all([
    fetchAll('brand'),
    fetchAll('categories'),
    fetchAll('productlines'),
  ]);

  // Mapas: clave string → Id entero de PS
  const brandByNumber    = {};  // BrandNumber   → Id
  const categoryByNumber = {};  // CategoryNumber → Id
  const lineByNumber     = {};  // LineNumber     → Id

  for (const b of brands)     brandByNumber[String(b.BrandNumber ?? '').trim()]    = b.Id;
  for (const c of categories) categoryByNumber[String(c.CategoryNumber ?? '').trim()] = c.Id;
  for (const l of lines)      lineByNumber[String(l.LineNumber ?? '').trim()]       = l.Id;

  cache = { brandByNumber, categoryByNumber, lineByNumber };
  lastFetch = Date.now();
  console.log(`[catalogCache] Listo — ${brands.length} marcas, ${categories.length} categorías, ${lines.length} líneas`);
}

async function getCache() {
  if (!cache || Date.now() - lastFetch > REFRESH_MS) {
    await buildCache();
  }
  return cache;
}

/** Resuelve BrandNumber → Id entero (o null si no existe) */
async function resolveBrandId(brandNumber) {
  const c = await getCache();
  const id = c.brandByNumber[String(brandNumber ?? '').trim()];
  return id !== undefined ? id : null;
}

/** Resuelve CategoryNumber → Id entero (o null si no existe) */
async function resolveCategoryId(categoryNumber) {
  const c = await getCache();
  const id = c.categoryByNumber[String(categoryNumber ?? '').trim()];
  return id !== undefined ? id : null;
}

/** Resuelve LineNumber → Id entero (o null si no existe) */
async function resolveLineId(lineNumber) {
  const c = await getCache();
  const id = c.lineByNumber[String(lineNumber ?? '').trim()];
  return id !== undefined ? id : null;
}

/** Fuerza recarga del caché (útil para debugging) */
async function refresh() { await buildCache(); }

module.exports = { resolveBrandId, resolveCategoryId, resolveLineId, refresh, getCache };
