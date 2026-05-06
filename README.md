# PowerSales Sync

Worker CDC en tiempo real + Dashboard React para sincronizar **ERP Magic → PowerSales API**.

```
powersales-sync/
├── backend/    # Node.js worker (ZongJi binlog) + Express REST + WebSocket
└── frontend/   # Dashboard React + Vite
```

---

## Requisitos previos

| Requisito | Versión mínima |
|-----------|----------------|
| Node.js   | 18+            |
| npm       | 9+             |
| MySQL     | 5.7+ con binlog habilitado |

### Permisos MySQL requeridos

El usuario `root` (o el que configures) necesita:

```sql
GRANT REPLICATION SLAVE, REPLICATION CLIENT ON *.* TO 'root'@'%';
FLUSH PRIVILEGES;
```

### Habilitar binlog en MySQL (`my.ini` / `my.cnf`)

```ini
[mysqld]
log_bin          = mysql-bin
binlog_format    = ROW
binlog_row_image = FULL
server_id        = 1
```

Reinicia MySQL después de editar. Verifica con:

```sql
SHOW VARIABLES LIKE 'log_bin';        -- debe ser ON
SHOW VARIABLES LIKE 'binlog_format';  -- debe ser ROW
```

### Nota sobre `sincronizado`

La columna usa 3 estados:
- `0` = pendiente
- `1` = sincronizado OK
- `2` = error (extiende el schema original)

Ejecuta esto si ya tienes datos con schema antiguo (0/1 solo):

```sql
ALTER TABLE Cambios MODIFY COLUMN sincronizado TINYINT UNSIGNED NOT NULL DEFAULT 0;
```

---

## Instalación

```bash
# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
```

---

## Desarrollo

```bash
# Terminal 1 — Backend (puerto 3001, WS 3002)
cd backend
npm run dev

# Terminal 2 — Frontend (puerto 5173)
cd frontend
npm run dev
```

Abre `http://localhost:5173`

---

## Variables de entorno (backend/.env)

```env
MYSQL_HOST=192.168.60.42
MYSQL_PORT=3306
MYSQL_DB=aiesa
MYSQL_USER=root
MYSQL_PASS=
PS_BASE_URL=https://api.dev.powersales.cloud/api/grupoascencio
PS_TOKEN=438|RJjhTTLgA6yDcJChu5W8bjfJU6scO0LyEBAOcUyd
PS_EMPRESA=00001
PORT=3001
WS_PORT=3002
```

---

## Producción con pm2

```bash
# Instalar pm2 globalmente
npm install -g pm2

# Backend
cd backend
pm2 start index.js --name powersales-backend

# Build frontend
cd ../frontend
npm run build
# Servir con nginx o pm2 serve:
pm2 serve dist 8080 --name powersales-frontend

# Guardar procesos para reinicio automático
pm2 save
pm2 startup
```

---

## API REST

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/status` | Estado worker, binlog, conteos |
| GET | `/api/cambios` | Lista paginada (`?tabla=&sincronizado=&page=&limit=`) |
| GET | `/api/cambios/:id` | Detalle de un cambio |
| POST | `/api/cambios/retry/:id` | Reintentar un registro fallido |
| POST | `/api/cambios/retry-all` | Reintentar todos los errores |
| GET | `/api/config` | Configuración actual |
| PUT | `/api/config` | Actualizar configuración en caliente |
| POST | `/api/worker/pause` | Pausar el worker |
| POST | `/api/worker/resume` | Reanudar el worker |

## WebSocket (ws://localhost:3002)

```json
{ "event": "sync_ok",      "data": { "id": 12, "tabla": "articulo", "clave": "ABC123", "ms": 87 } }
{ "event": "sync_error",   "data": { "id": 13, "tabla": "articulo", "error": "404 Not Found" } }
{ "event": "worker_status","data": { "paused": false, "binlog": "connected" } }
```

---

## Añadir nuevas tablas

1. Crea `backend/src/handlers/cliente.js` (exporta `async sync(cambio)`)
2. Regístralo en `backend/src/processor.js`:
   ```js
   const clienteHandler = require('./handlers/cliente');
   const HANDLERS = { articulo, cliente: clienteHandler };
   ```
3. Activa la tabla desde la UI → Configuración → Tablas activas
# Proteo
