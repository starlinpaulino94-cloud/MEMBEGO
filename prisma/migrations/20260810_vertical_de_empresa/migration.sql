-- ============================================================================
-- PLATAFORMA · Fase 7 — EL VERTICAL DE UNA EMPRESA DEJA DE SER UNA LISTA FIJA
-- ============================================================================
--
-- QUÉ ARREGLA
--
-- La Fase 1b convirtió los tipos de negocio en tabla (`tipos_negocio`) para que
-- registrar un vertical nuevo fuera escribir filas y no desplegar código. Pero
-- el vertical de una EMPRESA seguía saliendo de un `switch` de cuatro casos con
-- `default: 'CAR_WASH'`.
--
-- Con eso, se podía dar de alta el sistema de un hotel y ninguna empresa podía
-- ser compatible con él jamás: el registro era datos, la compatibilidad seguía
-- siendo código. Lo destapó la prueba contra base real de la Fase 7, donde una
-- empresa creada con `type = 'restaurant'` caía en el `default` y quedaba
-- clasificada como lavadero.
--
-- ----------------------------------------------------------------------------
-- POR QUÉ ES SEGURA
--
-- Aditiva, idempotente y RELLENADA reproduciendo exactamente la resolución de
-- hoy (`capacidades->>'categoria'`, si no el mapeo de `type`). Ninguna empresa
-- cambia de vertical el día del despliegue: al terminar, cada fila lleva
-- escrito el mismo valor que el código calculaba al vuelo.
--
-- La columna es NULLABLE a propósito. Una empresa creada por un camino que aún
-- no la rellene se resuelve como siempre, en vez de quedarse sin vertical y
-- perder el acceso a sus sistemas.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'companies'
      AND column_name = 'tipoNegocioCodigo'
  ) THEN
    ALTER TABLE "companies" ADD COLUMN "tipoNegocioCodigo" TEXT;

    -- El relleno va DENTRO del guard para que corra exactamente una vez. Fuera,
    -- una segunda ejecución pisaría el vertical que alguien haya cambiado a
    -- mano desde entonces.
    UPDATE "companies"
       SET "tipoNegocioCodigo" = COALESCE(
             NULLIF("capacidades" ->> 'categoria', ''),
             CASE lower(COALESCE("type", ''))
               WHEN 'restaurante' THEN 'RESTAURANTE'
               WHEN 'barberia'    THEN 'BARBERIA'
               WHEN 'salon'       THEN 'BARBERIA'
               WHEN 'gym'         THEN 'GYM'
               WHEN 'gimnasio'    THEN 'GYM'
               ELSE 'CAR_WASH'
             END
           );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "companies_tipoNegocioCodigo_idx"
  ON "companies" ("tipoNegocioCodigo");

-- Los cuatro verticales de siempre tienen que EXISTIR en la tabla: si no, el
-- relleno de arriba dejaría códigos que no apuntan a ningún tipo de negocio y
-- toda empresa quedaría incompatible con todo.
--
-- No hay FOREIGN KEY a propósito: `tipos_negocio` es un catálogo que se edita
-- desde el panel, y una clave ajena convertiría «alguien renombró un código» en
-- «no se puede guardar la empresa». La integridad la vigila la aplicación, que
-- puede explicarla.
INSERT INTO "tipos_negocio" ("id", "codigo", "nombre", "orden", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'CAR_WASH',    'Car Wash',    10, now()),
  (gen_random_uuid()::text, 'RESTAURANTE', 'Restaurante', 20, now()),
  (gen_random_uuid()::text, 'BARBERIA',    'Barbería',    30, now()),
  (gen_random_uuid()::text, 'GYM',         'Gimnasio',    40, now())
ON CONFLICT ("codigo") DO NOTHING;
