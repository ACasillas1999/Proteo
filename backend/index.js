'use strict';
require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const http    = require('http');

const { initWebSocket } = require('./src/websocket');
const { startBinlog }   = require('./src/binlog');
const { startPoller }   = require('./src/processor');
const { migrate }       = require('./src/localdb');

const statusRouter      = require('./routes/status');
const cambiosRouter     = require('./routes/cambios');
const configRouter      = require('./routes/config');
const workerRouter      = require('./routes/worker');
const mapeoRouter       = require('./routes/mapeo');
const syncHistoryRouter = require('./routes/syncHistory');
const webhooksRouter    = require('./routes/webhooks');
const grupoascencioRouter = require('./routes/grupoascencio');

const app = express();
app.use(cors());
app.use(express.json());

// ── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/status',       statusRouter);
app.use('/api/cambios',      cambiosRouter);
app.use('/api',              configRouter);        // GET/PUT /api/config
app.use('/api/worker',       workerRouter);        // POST /api/worker/pause|resume
app.use('/api/mapeo',        mapeoRouter);         // GET/PUT /api/mapeo
app.use('/api/sync-history', syncHistoryRouter);   // GET /api/sync-history
app.use('/api/webhooks',     webhooksRouter);      // POST /api/webhooks/...
app.use('/api/grupoascencio', grupoascencioRouter); // GET/POST /api/grupoascencio/pricelists...

// Health check
app.get('/', (_req, res) => res.json({ ok: true, service: 'powersales-sync' }));

// ── Arranque ─────────────────────────────────────────────────────────────────
migrate()
  .then(() => {
    // ── HTTP server
    const PORT = parseInt(process.env.PORT) || 3001;
    const server = http.createServer(app);
    server.listen(PORT, () => console.log(`[API] REST server → http://localhost:${PORT}`));

    // ── WebSocket
    const WS_PORT = parseInt(process.env.WS_PORT) || 3002;
    initWebSocket(WS_PORT);

    // ── Background Poller
    startPoller(5000);

    // ── Binlog CDC
    startBinlog().catch(err => {
      console.error('[BINLOG] Startup failed:', err.message);
      console.error('[BINLOG] El worker funcionará solo via REST.');
    });
  })
  .catch(err => {
    console.error('[LocalDB] ✗ Error en migración:', err.message);
    console.error('[LocalDB] Verifica que proteo_db exista y las credenciales LOCAL_MYSQL_* sean correctas.');
    process.exit(1);
  });
