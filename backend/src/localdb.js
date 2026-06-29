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
      timezone:           'local',   // usa el timezone del servidor (UTC-6), no UTC
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
        \`key\`          VARCHAR(100) NOT NULL PRIMARY KEY,
        \`config_value\` TEXT,
        updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
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

    await conn.query(`
      CREATE TABLE IF NOT EXISTS webhook_logs (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        entidad         VARCHAR(50)  NOT NULL,
        clave_registro  VARCHAR(100) NOT NULL,
        datos           JSON         DEFAULT NULL,
        estado          TINYINT      NOT NULL DEFAULT 0 COMMENT '1=ok, 2=error',
        error_msg       TEXT         DEFAULT NULL,
        branch_id       INT          DEFAULT NULL,
        fecha_recepcion DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_entidad   (entidad),
        INDEX idx_estado    (estado),
        INDEX idx_clave     (clave_registro),
        INDEX idx_fecha     (fecha_recepcion),
        INDEX idx_branch    (branch_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await conn.query(`
      INSERT INTO field_mapping (entity, ps_field, erp_column)
      VALUES ('cliente', 'Email', 'e_mail')
      ON DUPLICATE KEY UPDATE erp_column = IF(erp_column IS NULL OR erp_column = '', 'e_mail', erp_column)
    `);

    // Migration guards for instances created before multi-branch support
    try { await conn.query(`ALTER TABLE webhook_logs ADD COLUMN branch_id INT DEFAULT NULL`); } catch {}
    try { await conn.query(`ALTER TABLE webhook_logs ADD INDEX idx_branch (branch_id)`); } catch {}

    await conn.query(`
      CREATE TABLE IF NOT EXISTS branch_status (
        branch_id     INT          NOT NULL PRIMARY KEY,
        last_seen_at  DATETIME     NOT NULL,
        last_poll_id  INT          DEFAULT 0,
        erp_connected TINYINT(1)   DEFAULT 0,
        app_version   VARCHAR(50)  DEFAULT NULL,
        hostname      VARCHAR(100) DEFAULT NULL,
        updated_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS field_mapping_overrides (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        branch_id   INT          NOT NULL,
        entity      VARCHAR(50)  NOT NULL,
        ps_field    VARCHAR(100) NOT NULL,
        erp_column  VARCHAR(100) DEFAULT NULL,
        fixed_value VARCHAR(255) DEFAULT NULL,
        updated_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_branch_entity_field (branch_id, entity, ps_field)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    console.log('[LocalDB] ✓ Tablas verificadas en proteo_db');
  } finally {
    conn.release();
  }
}

// ── Helpers de config ────────────────────────────────────────────────────────

async function getConfig(key, defaultVal = null) {
  const [rows] = await localQuery('SELECT `config_value` FROM app_config WHERE `key` = ?', [key]);
  if (!rows.length) return defaultVal;
  try { return JSON.parse(rows[0].config_value); } catch { return rows[0].config_value; }
}

async function setConfig(key, value) {
  const v = typeof value === 'string' ? value : JSON.stringify(value);
  await localQuery(
    'INSERT INTO app_config (`key`, `config_value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `config_value` = VALUES(`config_value`)',
    [key, v]
  );
}

async function getAllConfig() {
  const [rows] = await localQuery('SELECT `key`, `config_value` FROM app_config');
  const out = {};
  for (const r of rows) {
    try { out[r.key] = JSON.parse(r.config_value); } catch { out[r.key] = r.config_value; }
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
 */
async function saveSyncHistory(cambio, estado, errorMsg = null, intentos = 1, payload = null) {
  const datosJson = payload
    ? JSON.stringify(payload)
    : (cambio.datos ? JSON.stringify(cambio.datos) : null);

  await localQuery(
    `INSERT INTO sync_history
       (cambio_id, entidad, operacion, clave_registro, datos, estado, error_msg, intentos, fecha_cambio)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      cambio.id,
      cambio.entidad       || cambio.tabla || 'desconocido',
      cambio.operacion     || cambio.tipo  || 'UPDATE',
      cambio.clave_registro,
      datosJson,
      estado,
      errorMsg ? String(errorMsg).substring(0, 2000) : null,
      intentos,
      cambio.fecha_cambio  || cambio.fecha || null,
    ]
  );
}

/**
 * Guarda el log de un webhook recibido.
 */
async function saveWebhookLog(entidad, claveRegistro, datos, estado, errorMsg = null, branchId = null) {
  const datosJson = datos ? JSON.stringify(datos) : null;

  await localQuery(
    `INSERT INTO webhook_logs
       (entidad, clave_registro, datos, estado, error_msg, branch_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      entidad,
      claveRegistro,
      datosJson,
      estado,
      errorMsg ? String(errorMsg).substring(0, 2000) : null,
      branchId ?? null,
    ]
  );
}

// ── Branch mapping overrides ─────────────────────────────────────────────────

async function getMappingForBranch(entity, branchId) {
  const [global]    = await localQuery('SELECT ps_field, erp_column, fixed_value FROM field_mapping WHERE entity = ?', [entity]);
  const [overrides] = await localQuery('SELECT ps_field, erp_column, fixed_value FROM field_mapping_overrides WHERE entity = ? AND branch_id = ?', [entity, branchId]);

  const map = {};
  for (const r of global)    map[r.ps_field] = r.erp_column ?? r.fixed_value ?? null;
  for (const r of overrides) map[r.ps_field] = r.erp_column ?? r.fixed_value ?? null;
  return map;
}

async function saveOverrideMapping(branchId, entity, mappings) {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('DELETE FROM field_mapping_overrides WHERE branch_id = ? AND entity = ?', [branchId, entity]);
    for (const [psField, val] of Object.entries(mappings)) {
      const isFixed = typeof val === 'number';
      await conn.execute(
        'INSERT INTO field_mapping_overrides (branch_id, entity, ps_field, erp_column, fixed_value) VALUES (?, ?, ?, ?, ?)',
        [branchId, entity, psField, isFixed ? null : (val || null), isFixed ? String(val) : null]
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

// ── Branch status (heartbeat) ────────────────────────────────────────────────

async function upsertBranchStatus(branchId, { lastPollId = 0, erpConnected = 0, version = null, hostname = null } = {}) {
  await localQuery(
    `INSERT INTO branch_status (branch_id, last_seen_at, last_poll_id, erp_connected, app_version, hostname)
     VALUES (?, NOW(), ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       last_seen_at  = NOW(),
       last_poll_id  = VALUES(last_poll_id),
       erp_connected = VALUES(erp_connected),
       app_version   = VALUES(app_version),
       hostname      = VALUES(hostname)`,
    [branchId, lastPollId, erpConnected ? 1 : 0, version, hostname]
  );
}

async function getAllBranchStatuses() {
  const [rows] = await localQuery('SELECT * FROM branch_status ORDER BY branch_id ASC');
  return rows;
}

module.exports = {
  localQuery, migrate,
  getConfig, setConfig, getAllConfig,
  getFieldMapping, saveFieldMapping,
  getMappingForBranch, saveOverrideMapping,
  saveSyncHistory, saveWebhookLog,
  upsertBranchStatus, getAllBranchStatuses,
};
