'use strict';

/**
 * Config mutable en caliente.
 * PUT /api/config actualiza estos valores sin reiniciar el worker.
 */
const _cfg = {
  tablas_activas:  ['articulo'],
  max_retries:     3,
  retry_backoff_ms: 1000,
  paused:          false,
};

module.exports = {
  get()                { return { ..._cfg }; },
  update(partial)      { Object.assign(_cfg, partial); },
  isPaused()           { return _cfg.paused; },
  isTablaActiva(tabla) { return _cfg.tablas_activas.includes(tabla); },
};
