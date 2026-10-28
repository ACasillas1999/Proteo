-- ==========================================================
-- Triggers para la tabla: surtidopedido
-- Propósito: Registrar los cambios de estatus de picking en la tabla `Cambios`
-- para que Proteo los lea y los envíe a PowerSales.
--
-- Reglas de estatus según (Surtido, Faltante):
--   - Surtido = 1, Faltante = 0 -> 'FULLY_PICKED' (StatusId: 43)
--   - Surtido = 1, Faltante = 1 -> 'PARTIALLY_PICKED' (StatusId: 6)
--   - Surtido = 0, Faltante = 1 -> NULL (ignorado / no sincroniza)
--   - Surtido = 0, Faltante = 0 -> NULL (ignorado / no sincroniza)
-- ==========================================================

DELIMITER $$

-- 1. Trigger AFTER INSERT
DROP TRIGGER IF EXISTS trg_surtidopedido_after_insert$$
CREATE TRIGGER trg_surtidopedido_after_insert
AFTER INSERT ON surtidopedido
FOR EACH ROW
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
END$$

-- 2. Trigger AFTER UPDATE
DROP TRIGGER IF EXISTS trg_surtidopedido_after_update$$
CREATE TRIGGER trg_surtidopedido_after_update
AFTER UPDATE ON surtidopedido
FOR EACH ROW
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
END$$

DELIMITER ;
