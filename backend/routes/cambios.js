'use strict';
const router  = require('express').Router();
const { query } = require('../src/db');
const { processChange } = require('../src/processor');

// Expresión SQL de prioridad de subida (1 = más alta, 4 = más baja)
const PRIORITY_SQL = `CASE
  WHEN LOWER(tabla) IN ('surtidopedido', 'clientes') THEN 1
  WHEN LOWER(tabla) = 'articuloalm' THEN 2
  WHEN LOWER(tabla) = 'tipocamb' THEN 3
  WHEN LOWER(tabla) = 'articulo' THEN 4
  ELSE 2
END`;

// GET /api/cambios?tabla=&sincronizado=&sort=&page=&limit=
router.get('/', async (req, res) => {
  try {
    const { tabla, sincronizado, sort = 'priority', page = 1, limit = 50 } = req.query;

    let where  = 'WHERE 1=1';
    const params = [];

    if (tabla) {
      where += ' AND LOWER(tabla) = LOWER(?)';
      params.push(tabla);
    }
    if (sincronizado !== undefined && sincronizado !== '') {
      where += ' AND sincronizado = ?';
      params.push(parseInt(sincronizado));
    }

    // LIMIT/OFFSET se interpolan directamente (ya son enteros validados)
    // mysql2 execute() no soporta binding de enteros para LIMIT/OFFSET en MySQL 5.x
    const limitVal  = Math.max(1, parseInt(limit)  || 50);
    const offsetVal = Math.max(0, (Math.max(1, parseInt(page)) - 1) * limitVal);

    // Ordenamiento:
    // - 'priority' (por defecto):
    //     1º Los pendientes de subir (sincronizado = 0) hasta arriba
    //     2º Ordenados por prioridad de subida (1: surtidopedido/clientes, 2: articuloalm, 3: tipocamb, 4: articulo) y id ASC
    //     3º Abajo los ya procesados, del más reciente al más antiguo
    // - 'recent': orden cronológico tradicional (más recientes primero)
    const orderBySql = sort === 'recent'
      ? `ORDER BY COALESCE(fecha_sync, fecha_cambio) DESC, id DESC`
      : `ORDER BY
           CASE WHEN sincronizado = 0 THEN 0 ELSE 1 END ASC,
           CASE WHEN sincronizado = 0 THEN (${PRIORITY_SQL}) ELSE 99 END ASC,
           CASE WHEN sincronizado = 0 THEN id ELSE 0 END ASC,
           COALESCE(fecha_sync, fecha_cambio) DESC,
           id DESC`;

    const [rows] = await query(
      `SELECT *, (${PRIORITY_SQL}) AS prioridad FROM Cambios ${where} ${orderBySql} LIMIT ${limitVal} OFFSET ${offsetVal}`,
      params
    );
    const [[{ total }]] = await query(
      `SELECT COUNT(*) AS total FROM Cambios ${where}`,
      params
    );

    res.json({ ok: true, data: rows, total: Number(total), page: parseInt(page), limit: limitVal });
  } catch (e) {
    console.error('[API:CAMBIOS] Error listing:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/cambios/:id
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await query('SELECT * FROM Cambios WHERE id=? LIMIT 1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ ok: false, error: 'No encontrado' });
    res.json({ ok: true, data: rows[0] });
  } catch (e) {
    console.error('[API:CAMBIOS] Error getting detail:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/retry/:id
router.post('/retry/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [rows] = await query('SELECT id FROM Cambios WHERE id=? LIMIT 1', [id]);
    if (!rows.length) return res.status(404).json({ ok: false, error: 'No encontrado' });

    // Resetear a pendiente antes de reintentar
    await query('UPDATE Cambios SET sincronizado=0, error_sync=NULL WHERE id=?', [id]);

    processChange(id).catch(() => {}); // async, no bloquear respuesta
    res.json({ ok: true, message: `Reintentando cambio #${id}` });
  } catch (e) {
    console.error('[API:CAMBIOS] Error retry:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/retry-all
router.post('/retry-all', async (req, res) => {
  try {
    const [rows] = await query('SELECT id FROM Cambios WHERE sincronizado=2');
    if (!rows.length) return res.json({ ok: true, queued: 0 });

    const ids = rows.map(r => r.id);
    // Resetear todos a pendiente
    await query('UPDATE Cambios SET sincronizado=0, error_sync=NULL WHERE sincronizado=2');

    // Lanzar todos en paralelo (con pequeño delay entre ellos)
    ids.forEach((id, i) => {
      setTimeout(() => processChange(id).catch(() => {}), i * 200);
    });

    res.json({ ok: true, queued: ids.length });
  } catch (e) {
    console.error('[API:CAMBIOS] Error retry-all:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
