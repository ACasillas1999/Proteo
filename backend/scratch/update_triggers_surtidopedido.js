'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { getPool } = require('../src/db');

async function main() {
  console.log('[DB] Actualizando triggers de surtidopedido...');
  const pool = getPool();

  await pool.query('DROP TRIGGER IF EXISTS trg_surtidopedido_after_insert');
  const sqlInsert = `
    CREATE TRIGGER trg_surtidopedido_after_insert AFTER INSERT ON surtidopedido FOR EACH ROW
    BEGIN
      DECLARE estatus VARCHAR(30);
      SET estatus = NULL;

      IF NEW.Surtido = 1 AND NEW.Faltante = 0 THEN
        SET estatus = 'FULLY_PICKED';
      ELSEIF NEW.Surtido = 1 AND NEW.Faltante = 1 THEN
        SET estatus = 'PARTIALLY_PICKED';
      END IF;

      IF estatus IS NOT NULL THEN
        INSERT INTO Cambios (tabla, clave_registro, campos_modificados, fecha_cambio, sincronizado)
        VALUES ('surtidopedido', NEW.Folio, estatus, NOW(), 0);
      END IF;
    END
  `;
  await pool.query(sqlInsert);
  console.log('✓ Trigger trg_surtidopedido_after_insert actualizado correctamente.');

  await pool.query('DROP TRIGGER IF EXISTS trg_surtidopedido_after_update');
  const sqlUpdate = `
    CREATE TRIGGER trg_surtidopedido_after_update AFTER UPDATE ON surtidopedido FOR EACH ROW
    BEGIN
      DECLARE estatus VARCHAR(30);
      SET estatus = NULL;

      IF (OLD.Surtido <> NEW.Surtido OR OLD.Faltante <> NEW.Faltante) THEN
        IF NEW.Surtido = 1 AND NEW.Faltante = 0 THEN
          SET estatus = 'FULLY_PICKED';
        ELSEIF NEW.Surtido = 1 AND NEW.Faltante = 1 THEN
          SET estatus = 'PARTIALLY_PICKED';
        END IF;

        IF estatus IS NOT NULL THEN
          INSERT INTO Cambios (tabla, clave_registro, campos_modificados, fecha_cambio, sincronizado)
          VALUES ('surtidopedido', NEW.Folio, estatus, NOW(), 0);
        END IF;
      END IF;
    END
  `;
  await pool.query(sqlUpdate);
  console.log('✓ Trigger trg_surtidopedido_after_update actualizado correctamente.');

  process.exit(0);
}

main().catch(err => {
  console.error('Error al actualizar triggers:', err);
  process.exit(1);
});
