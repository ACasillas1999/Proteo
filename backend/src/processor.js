'use strict';
const { query }                        = require('./db');
const { saveSyncHistory }              = require('./localdb');
const { broadcast }                    = require('./websocket');
const config                           = require('./config');

const articuloHandler = require('./handlers/articulo');

/** Mapa de handlers por nombre de tabla */
const HANDLERS = {
  articulo: articuloHandler,
  // cliente: clienteHandler,
};

/** Estado en memoria del processor (runtime stats) */
const _state = {
  processed:   0,
  errors:      0,
  totalMs:     0,
  lastEventAt: null,
};

function getStats() {
  return {
    processed:   _state.processed,
    errors:      _state.errors,
    avgMs:       _state.processed > 0 ? Math.round(_state.totalMs / _state.processed) : 0,
    lastEventAt: _state.lastEventAt,
  };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Procesa un registro de Cambios por su ID.
 * Flujo:
 *  1. Lee el cambio del ERP (60.42)
 *  2. Ejecuta el handler (sincroniza con PowerSales)
 *  3. Guarda resultado en proteo_db.sync_history (local)
 *  4. DELETE del registro en Cambios remoto → tabla siempre limpia
 */
async function processChange(cambioId) {
  if (config.isPaused()) {
    console.log(`[PROC] Worker en pausa, omitiendo #${cambioId}`);
    return;
  }

  // 1. Leer el cambio del ERP remoto
  let cambio;
  try {
    const [rows] = await query('SELECT * FROM Cambios WHERE id=? LIMIT 1', [cambioId]);
    if (!rows.length) {
      console.warn(`[PROC] Cambio #${cambioId} no encontrado en BD`);
      return;
    }
    cambio = rows[0];
  } catch (e) {
    console.error('[PROC] Error leyendo Cambios:', e.message);
    return;
  }

  const { tabla, clave_registro } = cambio;

  if (!config.isTablaActiva(tabla)) {
    console.log(`[PROC] Tabla '${tabla}' inactiva, omitiendo #${cambioId}`);
    // Aun así lo eliminamos para no bloquear la tabla remota
    await query('DELETE FROM Cambios WHERE id=?', [cambioId]).catch(() => {});
    return;
  }

  const handler = HANDLERS[tabla];
  if (!handler) {
    console.warn(`[PROC] Sin handler para tabla '${tabla}', eliminando cambio #${cambioId}`);
    await query('DELETE FROM Cambios WHERE id=?', [cambioId]).catch(() => {});
    return;
  }

  const cfg       = config.get();
  const t0        = Date.now();
  let   lastError = null;
  let   attempt   = 0;

  for (attempt = 1; attempt <= cfg.max_retries; attempt++) {
    try {
      await handler.sync(cambio);

      const ms = Date.now() - t0;

      // 3. Guardar OK en historial local
      await saveSyncHistory(cambio, 1, null, attempt).catch(e =>
        console.error('[PROC] Error guardando historial local:', e.message)
      );

      // 4. Borrar de la tabla remota Cambios
      await query('DELETE FROM Cambios WHERE id=?', [cambioId]).catch(e =>
        console.error('[PROC] Error eliminando cambio remoto:', e.message)
      );

      _state.processed++;
      _state.totalMs  += ms;
      _state.lastEventAt = new Date();

      console.log(`[PROC] ✓ #${cambioId} (${tabla}/${clave_registro}) en ${ms}ms`);
      broadcast('sync_ok', { id: cambioId, tabla, clave: clave_registro, ms });
      return;

    } catch (err) {
      lastError = err.message;
      if (attempt < cfg.max_retries) {
        const delay = cfg.retry_backoff_ms * attempt;
        console.warn(`[PROC] ✗ #${cambioId} intento ${attempt}: ${lastError}. Reintentando en ${delay}ms...`);
        await sleep(delay);
      }
    }
  }

  // Agotados los reintentos — guardar error en historial y borrar de remoto
  _state.errors++;

  await saveSyncHistory(cambio, 2, lastError, attempt - 1).catch(e =>
    console.error('[PROC] Error guardando historial de error:', e.message)
  );

  // Borrar igualmente para no bloquear la tabla; el historial ya tiene el error
  await query('DELETE FROM Cambios WHERE id=?', [cambioId]).catch(e =>
    console.error('[PROC] Error eliminando cambio remoto fallido:', e.message)
  );

  console.error(`[PROC] ✗ #${cambioId} falló tras ${cfg.max_retries} intentos: ${lastError}`);
  broadcast('sync_error', { id: cambioId, tabla, clave: clave_registro, error: lastError });
}

let _pollerTimer = null;
let _isPolling   = false;

async function pollPendingChanges() {
  if (_isPolling || config.isPaused()) return;
  _isPolling = true;
  try {
    // Leer solo los pendientes (sincronizado = 0) del remoto
    const [rows] = await query('SELECT id FROM Cambios WHERE sincronizado = 0 ORDER BY id ASC LIMIT 10');
    for (const row of rows) {
      if (config.isPaused()) break;
      await processChange(row.id);
    }
  } catch (err) {
    console.error('[POLLER] Error:', err.message);
  } finally {
    _isPolling = false;
  }
}

function startPoller(intervalMs = 5000) {
  if (_pollerTimer) clearInterval(_pollerTimer);
  _pollerTimer = setInterval(pollPendingChanges, intervalMs);
  console.log(`[POLLER] Iniciado con intervalo de ${intervalMs}ms`);
  pollPendingChanges();
}

function stopPoller() {
  if (_pollerTimer) {
    clearInterval(_pollerTimer);
    _pollerTimer = null;
    console.log('[POLLER] Detenido');
  }
}

module.exports = { processChange, getStats, startPoller, stopPoller };
