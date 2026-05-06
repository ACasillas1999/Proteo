'use strict';
const mysql = require('mysql2/promise');

let _pool = null;

function getPool() {
  if (!_pool) {
    _pool = mysql.createPool({
      host:               process.env.LOCAL_MYSQL_HOST || '127.0.0.1',
      port:               parseInt(process.env.LOCAL_MYSQL_PORT) || 3306,
      database:           process.env.LOCAL_MYSQL_DB  || 'proteo_db',
      user:               process.env.LOCAL_MYSQL_USER || 'root',
      password:           process.env.LOCAL_MYSQL_PASS || '',
      waitForConnections: true,
      connectionLimit:    5,
      queueLimit:         0,
      timezone:           '+00:00',
      multipleStatements: true,
    });
  }
  return _pool;
}

async function localQuery(sql, params = []) {
  return getPool().execute(sql, params);
}

/**
 * Crea las tablas si no existen.
 * Se llama una vez al arrancar el servidor.
 */
async function migrate() {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS app_config (
        \`key\`      VARCHAR(100) NOT NULL PRIMARY KEY,
        \`value\`    TEXT,
        updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS field_mapping (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        entity      VARCHAR(50)  NOT NULL DEFAULT 'articulo',
        ps_field    VARCHAR(100) NOT NULL,
        erp_column  VARCHAR(100) DEFAULT NULL,
        fixed_value VARCHAR(255) DEFAULT NULL,
        updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_entity_field (entity, ps_field)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS sync_history (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        cambio_id       INT          NOT NULL,
        entidad         VARCHAR(50)  NOT NULL,
        operacion       VARCHAR(20)  NOT NULL,
        clave_registro  VARCHAR(100) NOT NULL,
        datos           JSON         DEFAULT NULL,
        estado          TINYINT      NOT NULL DEFAULT 0 COMMENT '1=ok, 2=error',
        error_msg       TEXT         DEFAULT NULL,
        intentos        INT          NOT NULL DEFAULT 1,
        fecha_cambio    DATETIME     DEFAULT NULL,
        fecha_sync      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_entidad   (entidad),
        INDEX idx_estado    (estado),
        INDEX idx_clave     (clave_registro),
        INDEX idx_fecha     (fecha_sync)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    console.log('[LocalDB] ✓ Tablas verificadas en proteo_db');
  } finally {
    conn.release();
  }
}

// ── Helpers de config ────────────────────────────────────────────────────────

async function getConfig(key, defaultVal = null) {
  const [rows] = await localQuery('SELECT `value` FROM app_config WHERE `key` = ?', [key]);
  if (!rows.length) return defaultVal;
  try { return JSON.parse(rows[0].value); } catch { return rows[0].value; }
}

async function setConfig(key, value) {
  const v = typeof value === 'string' ? value : JSON.stringify(value);
  await localQuery(
    'INSERT INTO app_config (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
    [key, v]
  );
}

async function getAllConfig() {
  const [rows] = await localQuery('SELECT `key`, `value` FROM app_config');
  const out = {};
  for (const r of rows) {
    try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; }
  }
  return out;
}

// ── Helpers de field_mapping ─────────────────────────────────────────────────

async function getFieldMapping(entity = 'articulo') {
  const [rows] = await localQuery(
    'SELECT ps_field, erp_column, fixed_value FROM field_mapping WHERE entity = ?',
    [entity]
  );
  const map = {};
  for (const r of rows) {
    map[r.ps_field] = r.erp_column ?? r.fixed_value ?? null;
  }
  return map;
}

async function saveFieldMapping(entity, mappings) {
  // mappings = { SKU: 'Clave_Articulo', BrandId: 1, ... }
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('DELETE FROM field_mapping WHERE entity = ?', [entity]);
    for (const [psField, val] of Object.entries(mappings)) {
      const isFixed = typeof val === 'number';
      await conn.execute(
        'INSERT INTO field_mapping (entity, ps_field, erp_column, fixed_value) VALUES (?, ?, ?, ?)',
        [entity, psField, isFixed ? null : (val || null), isFixed ? String(val) : null]
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Guarda el resultado de un intento de sincronización en el historial local.
 * @param {object} cambio    - Registro original de la tabla Cambios
 * @param {number} estado    - 1=ok, 2=error
 * @param {string} errorMsg  - Mensaje de error (si aplica)
 * @param {number} intentos  - Número de intentos realizados
 */
async function saveSyncHistory(cambio, estado, errorMsg = null, intentos = 1) {
  await localQuery(
    `INSERT INTO sync_history
       (cambio_id, entidad, operacion, clave_registro, datos, estado, error_msg, intentos, fecha_cambio)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      cambio.id,
      cambio.entidad       || cambio.tabla || 'desconocido',
      cambio.operacion     || cambio.tipo  || 'UPDATE',
      cambio.clave_registro,
      cambio.datos ? JSON.stringify(cambio.datos) : null,
      estado,
      errorMsg ? String(errorMsg).substring(0, 2000) : null,
      intentos,
      cambio.fecha_cambio  || cambio.fecha || null,
    ]
  );
}

module.exports = {
  localQuery, migrate,
  getConfig, setConfig, getAllConfig,
  getFieldMapping, saveFieldMapping,
  saveSyncHistory,
};
