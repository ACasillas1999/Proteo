'use strict';
const { query, markSynced, markError, markLocal } = require('./db');
const { saveSyncHistory }              = require('./localdb');
const { broadcast }                    = require('./websocket');
const config                           = require('./config');

const articuloHandler = require('./handlers/articulo');
const articuloalmHandler = require('./handlers/articuloalm');
const clienteHandler = require('./handlers/cliente');
const surtidopedidoHandler = require('./handlers/surtidopedido');
const tipocambHandler = require('./handlers/tipocamb');

/** Mapa de handlers por nombre de tabla */
const HANDLERS = {
  articulo: articuloHandler,
  articuloalm: articuloalmHandler,
  clientes: clienteHandler,
  surtidopedido: surtidopedidoHandler,
  tipocamb: tipocambHandler,
  Tipocamb: tipocambHandler,
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

class OfflineError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OfflineError';
  }
}

function isOfflineError(err) {
  const msg = (err.message || '').toLowerCase();
  if (msg.includes('lock wait timeout')) return false;
  return (
    msg.includes('timeout of') ||
    msg.includes('network error') ||
    msg.includes('econnrefused') ||
    msg.includes('etimedout') ||
    msg.includes('enotfound') ||
    msg.includes('status code 502') ||
    msg.includes('status code 503') ||
    msg.includes('status code 504')
  );
}

let _lastTimeoutAt = 0;
const OFFLINE_COOLDOWN_MS = 2 * 60 * 1000; // 2 minutos de pausa si la API externa está caída

// Set de IDs actualmente en ejecución para evitar doble procesamiento entre Carril Rápido (binlog) y Poller
const _inFlight = new Set();

// Mapa de prioridades (menor número = mayor prioridad)
// 1: surtidopedido, clientes | 2: articuloalm | 3: tipocamb | 4: articulo
function getTablePriority(tabla) {
  const t = String(tabla || '').toLowerCase();
  if (t === 'surtidopedido' || t === 'clientes') return 1;
  if (t === 'articuloalm') return 2;
  if (t === 'tipocamb') return 3;
  if (t === 'articulo') return 4;
  return 2;
}

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

  if (_inFlight.has(cambioId)) {
    return;
  }
  _inFlight.add(cambioId);

  try {
    return await _processChangeInner(cambioId);
  } finally {
    _inFlight.delete(cambioId);
  }
}

async function _processChangeInner(cambioId) {

  // 1. Leer el cambio del ERP remoto
  let cambio;
  try {
    const [rows] = await query('SELECT * FROM Cambios WHERE id=? LIMIT 1', [cambioId]);
    if (!rows.length) {
      console.warn(`[PROC] Cambio #${cambioId} no encontrado en BD (puede haberse procesado ya), saltando.`);
      // Marcar como procesado por si acaso
      await markSynced(cambioId).catch(() => {});
      return;
    }
    cambio = rows[0];
    
    // Evitar el "ECHO" de los webhooks o procesos repetidos
    if (cambio.sincronizado !== 0) {
      console.log(`[PROC] Cambio #${cambioId} ya está marcado como sincronizado (echo evitado).`);
      return;
    }
  } catch (e) {
    console.error('[PROC] Error leyendo Cambios:', e.message);
    return;
  }

  const { tabla, clave_registro } = cambio;

  if (!config.isTablaActiva(tabla)) {
    console.log(`[PROC] Tabla '${tabla}' inactiva, omitiendo #${cambioId}`);
    await markSynced(cambioId).catch(() => {});
    return;
  }

  const handler = HANDLERS[tabla];
  if (!handler) {
    console.warn(`[PROC] Sin handler para tabla '${tabla}', marcando #${cambioId} como procesado`);
    await markSynced(cambioId).catch(() => {});
    return;
  }

  const cfg         = config.get();
  const maxAttempts = String(tabla).toLowerCase() === 'tipocamb' ? 1 : cfg.max_retries;
  const t0          = Date.now();
  let   lastError   = null;
  let   attempt     = 0;

  for (attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const payload = await handler.sync(cambio);

      const ms = Date.now() - t0;

      // Si el handler indica que es un registro exclusivamente local del ERP (ej. pedido con IDPs=0)
      if (payload && payload.__isLocal) {
        await saveSyncHistory(cambio, 3, payload.reason || 'Registro local del ERP', attempt, payload.payload || null, ms).catch(e =>
          console.error('[PROC] Error guardando historial local:', e.message)
        );
        await markLocal(cambioId, payload.reason || 'Registro local del ERP').catch(e =>
          console.error('[PROC] Error marcando cambio remoto como local:', e.message)
        );
        console.log(`[PROC] 🏠 #${cambioId} (${tabla}/${clave_registro}) marcado como Local en ${ms}ms`);
        broadcast('sync_ok', { id: cambioId, tabla, clave: clave_registro, ms, local: true });
        return;
      }

      // 3. Guardar OK en historial local (con payload enviado y latencia)
      await saveSyncHistory(cambio, 1, null, attempt, payload, ms).catch(e =>
        console.error('[PROC] Error guardando historial local:', e.message)
      );

      // 4. Marcar como sincronizado con fecha_sync
      await markSynced(cambioId).catch(e =>
        console.error('[PROC] Error marcando cambio remoto:', e.message)
      );

      _state.processed++;
      _state.totalMs  += ms;
      _state.lastEventAt = new Date();

      console.log(`[PROC] ✓ #${cambioId} (${tabla}/${clave_registro}) en ${ms}ms`);
      broadcast('sync_ok', { id: cambioId, tabla, clave: clave_registro, ms });
      broadcast('worker_status', { isOffline: false });
      return;

    } catch (err) {
      lastError = err.message;
      if (isOfflineError(err)) {
        _lastTimeoutAt = Date.now();
        console.warn(`[PROC] ✗ #${cambioId} falló por desconexión de red: ${lastError}. Abortando reintentos para activar cooldown.`);
        broadcast('worker_status', { isOffline: true, cooldownEndAt: _lastTimeoutAt + OFFLINE_COOLDOWN_MS });
        throw new OfflineError(lastError);
      }
      if (attempt < maxAttempts) {
        const delay = cfg.retry_backoff_ms * attempt;
        console.warn(`[PROC] ✗ #${cambioId} intento ${attempt}: ${lastError}. Reintentando en ${delay}ms...`);
        await sleep(delay);
      }
    }
  }

  // Agotados los reintentos — guardar error en historial y borrar de remoto
  _state.errors++;
  const msFailed = Date.now() - t0;

  await saveSyncHistory(cambio, 2, lastError, attempt - 1, null, msFailed).catch(e =>
    console.error('[PROC] Error guardando historial de error:', e.message)
  );

  // Marcar con error y guardar fecha_sync
  await markError(cambioId, lastError).catch(e =>
    console.error('[PROC] Error marcando cambio remoto fallido:', e.message)
  );

  console.error(`[PROC] ✗ #${cambioId} falló tras ${maxAttempts} intento(s): ${lastError}`);
  broadcast('sync_error', { id: cambioId, tabla, clave: clave_registro, error: lastError, ms: msFailed });
}

let _pollerTimer = null;
let _isPolling   = false;

// Cola de Carril Rápido (para eventos prioritarios del Binlog: surtidopedido, clientes, articuloalm, tipocamb)
// Concurrencia máxima = 2 para nunca saturar el pool de MySQL ni bloquear webhooks
const FAST_LANE_CONCURRENCY = 2;
const _fastLaneQueue = [];
let _fastLaneActive = 0;

function enqueueFromBinlog(id, tabla) {
  const priority = getTablePriority(tabla);

  // Si es 'articulo' (prioridad 4, carga masiva con 3 peticiones HTTP por SKU),
  // NO saturamos con llamadas paralelas: despertamos al poller para que los procese en orden de fondo.
  if (priority >= 4) {
    pollPendingChanges().catch(() => {});
    return;
  }

  // Carril rápido para prioridad 1 (surtidopedido/clientes), 2 (articuloalm) y 3 (tipocamb)
  if (_inFlight.has(id) || _fastLaneQueue.some(item => item.id === id)) {
    return;
  }

  _fastLaneQueue.push({ id, tabla, priority });
  // Ordenar cola del carril rápido por prioridad y luego por ID
  _fastLaneQueue.sort((a, b) => (a.priority - b.priority) || (a.id - b.id));
  _drainFastLane();
}

function _drainFastLane() {
  if (config.isPaused() || (Date.now() - _lastTimeoutAt < OFFLINE_COOLDOWN_MS)) return;

  while (_fastLaneActive < FAST_LANE_CONCURRENCY && _fastLaneQueue.length > 0) {
    const next = _fastLaneQueue.shift();
    if (!next || _inFlight.has(next.id)) continue;

    _fastLaneActive++;
    processChange(next.id)
      .catch(err => {
        if (!(err instanceof OfflineError)) {
          console.error(`[FAST-LANE] Error procesando #${next.id} (${next.tabla}):`, err.message);
        }
      })
      .finally(() => {
        _fastLaneActive--;
        _drainFastLane();
      });
  }
}

// Timeout de seguridad: si una vuelta del poller tarda mas de este tiempo, se libera el lock
const POLL_TIMEOUT_MS = 160_000;

async function pollPendingChanges() {
  if (_isPolling || config.isPaused()) return;

  // Cooldown si la API de PowerSales está caída para no procesar en bucle e inflar latencia
  if (Date.now() - _lastTimeoutAt < OFFLINE_COOLDOWN_MS) {
    return;
  }

  _isPolling = true;

  // Guardián: si en 160s la función no termina, liberar el lock para no bloquear la cola
  const safetyTimer = setTimeout(() => {
    console.warn('[POLLER] ⚠ Timeout de seguridad alcanzado (160s), liberando lock.');
    _isPolling = false;
  }, POLL_TIMEOUT_MS);

  let shouldRepollImmediately = false;

  try {
    // Orden de prioridad en cola:
    // 1: surtidopedido, clientes (Urgente)
    // 2: articuloalm (Existencias)
    // 3: tipocamb (Tipo de cambio — mayor prioridad que articulo)
    // 4: articulo (Carga masiva / Background)
    const [rows] = await query(`
      SELECT id, tabla FROM Cambios
      WHERE sincronizado = 0
      ORDER BY CASE
        WHEN LOWER(tabla) IN ('surtidopedido', 'clientes') THEN 1
        WHEN LOWER(tabla) = 'articuloalm' THEN 2
        WHEN LOWER(tabla) = 'tipocamb' THEN 3
        WHEN LOWER(tabla) = 'articulo' THEN 4
        ELSE 2
      END ASC, id ASC
      LIMIT 10
    `);
    // sincronizado: 0=pendiente, 1=ok, 2=error
    if (rows.length > 0) {
      console.log(`[POLLER] ${rows.length} registro(s) pendiente(s): ${rows.map(r => `#${r.id}(${r.tabla})`).join(', ')}`);
    }
    for (const row of rows) {
      if (config.isPaused()) break;

      // Si estamos procesando 'articulo' (prioridad 4) y entraron elementos urgentes al carril rápido
      // o a la BD (prioridad 1..3), cedemos el turno inmediatamente para no hacer esperar al tráfico prioritario.
      if (getTablePriority(row.tabla) >= 4) {
        if (_fastLaneQueue.length > 0) {
          console.log('[POLLER] ⚡ Cediendo lote de artículos para atender tráfico prioritario en Carril Rápido.');
          shouldRepollImmediately = true;
          break;
        }
        const [urgentRows] = await query(`
          SELECT id FROM Cambios
          WHERE sincronizado = 0 AND LOWER(tabla) != 'articulo'
          LIMIT 1
        `).catch(() => [[]]);
        if (urgentRows.length > 0) {
          console.log('[POLLER] ⚡ Detectado cambio prioritario en BD durante lote de artículos; reordenando cola.');
          shouldRepollImmediately = true;
          break;
        }
      }

      await processChange(row.id);
    }
  } catch (err) {
    if (err instanceof OfflineError) {
      console.warn(`[POLLER] Suspendiendo cola temporalmente: API de PowerSales fuera de línea (${err.message}).`);
    } else {
      console.error('[POLLER] Error:', err.message);
    }
  } finally {
    clearTimeout(safetyTimer);
    _isPolling = false;
    if (shouldRepollImmediately && !config.isPaused()) {
      setImmediate(() => pollPendingChanges().catch(() => {}));
    }
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

function isOffline() {
  return Date.now() - _lastTimeoutAt < OFFLINE_COOLDOWN_MS;
}

function getCooldownEndAt() {
  return _lastTimeoutAt > 0 ? _lastTimeoutAt + OFFLINE_COOLDOWN_MS : null;
}

function resetCooldown() {
  _lastTimeoutAt = 0;
  broadcast('worker_status', { isOffline: false, cooldownEndAt: null });
  pollPendingChanges().catch(e => console.error('[PROC] Error en forzado:', e.message));
}

module.exports = { processChange, enqueueFromBinlog, getStats, startPoller, stopPoller, isOffline, getCooldownEndAt, resetCooldown };
