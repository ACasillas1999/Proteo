'use strict';
const mysql = require('mysql2/promise');

let _pool = null;

function getPool() {
  if (!_pool) {
    _pool = mysql.createPool({
      host:             process.env.MYSQL_HOST,
      port:             parseInt(process.env.MYSQL_PORT) || 3306,
      database:         process.env.MYSQL_DB,
      user:             process.env.MYSQL_USER,
      password:         process.env.MYSQL_PASS || '',
      waitForConnections: true,
      connectionLimit:  10,
      queueLimit:       0,
      timezone:         '+00:00',
    });
    
    // Probar conexión de inmediato
    _pool.getConnection()
      .then(conn => {
        console.log(`[DB] ✓ Conexión exitosa a ${process.env.MYSQL_HOST}/${process.env.MYSQL_DB}`);
        conn.release();
      })
      .catch(err => {
        console.error(`[DB] ✗ Error de conexión a ${process.env.MYSQL_HOST}/${process.env.MYSQL_DB}:`, err.message);
      });
  }
  return _pool;
}

async function query(sql, params = []) {
  return getPool().execute(sql, params);
}

/** Marca un cambio como sincronizado correctamente (sincronizado=1) */
async function markSynced(id) {
  await query(
    'UPDATE Cambios SET sincronizado=1, fecha_sync=NOW(), error_sync=NULL WHERE id=?',
    [id]
  );
}

/**
 * Marca un cambio con error (sincronizado=2).
 * NOTA: el schema original usa TINYINT(1) para 0/1, ampliamos a 2=error.
 */
async function markError(id, errorMsg) {
  await query(
    'UPDATE Cambios SET sincronizado=2, error_sync=?, fecha_sync=NOW() WHERE id=?',
    [String(errorMsg).substring(0, 1000), id]
  );
}

module.exports = { getPool, query, markSynced, markError };
