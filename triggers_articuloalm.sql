-- ==========================================================
-- Triggers para la tabla: articuloalm
-- Propósito: Registrar los cambios de inventario en la tabla `Cambios`
-- para que Proteo los lea y los envíe a PowerSales.
-- ==========================================================

DELIMITER $$

-- 1. Trigger AFTER INSERT
DROP TRIGGER IF EXISTS trg_articuloalm_after_insert$$
CREATE TRIGGER trg_articuloalm_after_insert
AFTER INSERT ON articuloalm
FOR EACH ROW
BEGIN
  -- ⚡ Solo actuar si el cambio lo hizo el sistema (opcional: quitar el IF si quieres que registre todos los cambios)
  IF USER() LIKE 'root@%' THEN
    INSERT INTO `Cambios`
        (`tabla`, `clave_registro`, `campos_modificados`, `fecha_cambio`, `sincronizado`)
    VALUES
        ('articuloalm', CONCAT(NEW.`Clave_Articulo`, '|', NEW.`Almacen`), 'NUEVO_REGISTRO', NOW(), 0);
  END IF;
END$$


-- 2. Trigger AFTER UPDATE
DROP TRIGGER IF EXISTS trg_articuloalm_after_update$$
CREATE TRIGGER trg_articuloalm_after_update
AFTER UPDATE ON articuloalm
FOR EACH ROW
BEGIN
  DECLARE campos TEXT DEFAULT '';

  IF USER() LIKE 'root@%' THEN
    -- Solo impactar el inventario si cambia la existencia física
    IF NOT (OLD.`Existencia_Fisica`  <=> NEW.`Existencia_Fisica`)  THEN SET campos = CONCAT(campos, 'Existencia_Fisica,');  END IF;

    -- Solo insertar si realmente cambió la existencia
    IF campos != '' THEN
      SET campos = LEFT(campos, CHAR_LENGTH(campos) - 1); -- quitar coma final
      INSERT INTO `Cambios`
          (`tabla`, `clave_registro`, `campos_modificados`, `fecha_cambio`, `sincronizado`)
      VALUES
          ('articuloalm', CONCAT(NEW.`Clave_Articulo`, '|', NEW.`Almacen`), campos, NOW(), 0);
    END IF;

  END IF;
END$$


-- 3. Trigger AFTER DELETE
DROP TRIGGER IF EXISTS trg_articuloalm_after_delete$$
CREATE TRIGGER trg_articuloalm_after_delete
AFTER DELETE ON articuloalm
FOR EACH ROW
BEGIN
  IF USER() LIKE 'root@%' THEN
    INSERT INTO `Cambios`
        (`tabla`, `clave_registro`, `campos_modificados`, `fecha_cambio`, `sincronizado`)
    VALUES
        ('articuloalm', CONCAT(OLD.`Clave_Articulo`, '|', OLD.`Almacen`), 'REGISTRO_ELIMINADO', NOW(), 0);
  END IF;
END$$

DELIMITER ;
