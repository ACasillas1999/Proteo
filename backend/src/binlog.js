'use strict';
const ZongJi    = require('zongji');
const { processChange } = require('./processor');
const { broadcast }     = require('./websocket');
const config            = require('./config');

let _zongji      = null;
let _connected   = false;
let _lastEventAt = null;
let _startedAt   = null;
let _eventCount  = 0;

function getStatus() {
  return {
    connected:   _connected,
    startedAt:   _startedAt,
    lastEventAt: _lastEventAt,
    eventCount:  _eventCount,
  };
}

function startBinlog() {
  return new Promise((resolve, reject) => {
    // ZongJi requiere REPLICATION SLAVE/CLIENT → usa un usuario con esos permisos.
    // Si tienes usuario root separado, configura BINLOG_USER y BINLOG_PASS en .env.
    _zongji = new ZongJi({
      host:     process.env.MYSQL_HOST,
      port:     parseInt(process.env.MYSQL_PORT) || 3306,
      user:     process.env.BINLOG_USER || process.env.MYSQL_USER,
      password: process.env.BINLOG_PASS || process.env.MYSQL_PASS || '',
    });

    // Timeout de conexión: si en 10s no hay 'ready', rechazamos
    const timeout = setTimeout(() => {
      reject(new Error('Timeout esperando conexión binlog (10s)'));
    }, 10_000);

    _zongji.on('error', err => {
      console.error('[BINLOG] Error:', err.message);
      _connected = false;
      broadcast('worker_status', { paused: config.isPaused(), binlog: 'error', error: err.message });
    });

    _zongji.on('ready', () => {
      clearTimeout(timeout);
      console.log('[BINLOG] Conectado al binlog MySQL');
      _connected = true;
      _startedAt = new Date();
      broadcast('worker_status', { paused: config.isPaused(), binlog: 'connected' });
      resolve();
    });

    _zongji.on('binlog', evt => {
      if (evt.getTypeName() !== 'WriteRows') return;

      // Verificar que sea la tabla Cambios
      const tableName = evt.tableMap?.[evt.tableId]?.tableName;
      if (tableName !== 'Cambios') return;

      _lastEventAt = new Date();
      _eventCount++;

      for (const row of evt.rows) {
        const id = row.id;
        if (!id) continue;
        console.log(`[BINLOG] INSERT Cambios #${id} — tabla: ${row.tabla}, clave: ${row.clave_registro}`);
        processChange(id).catch(e =>
          console.error(`[BINLOG→PROC] Error procesando #${id}:`, e.message)
        );
      }
    });

    // serverId debe ser único por slave. Usa BINLOG_SERVER_ID en .env, o deriva de PS_BRANCH_ID.
    // El servidor MySQL master suele ser server_id=1 — no usar 1 aquí.
    const serverId = parseInt(process.env.BINLOG_SERVER_ID)
      || (100 + parseInt(process.env.PS_BRANCH_ID || 0));

    _zongji.start({
      includeEvents: ['tablemap', 'writerows'],
      includeSchema: { [process.env.MYSQL_DB]: ['Cambios'] },
      serverId,
    });
  });
}

function stopBinlog() {
  if (_zongji) {
    _zongji.stop();
    _connected = false;
    _zongji = null;
    console.log('[BINLOG] Detenido');
  }
}

module.exports = { startBinlog, stopBinlog, getStatus };
