-- ============================================================================
-- MEMBEGO CONNECT · Fase 14.1 — Identidad externa con unicidad
-- ============================================================================
-- QUÉ ARREGLA
--
-- El webhook de Meta llega sin sesión y sin empresa. Lo único que trae es la
-- cuenta de WhatsApp (WABA). La Fase 14 la buscaba con un `findFirst` global
-- sobre los metadatos de las credenciales: sin unicidad garantizada, dos
-- empresas con el mismo valor harían que el aviso de una acabara atribuido a
-- la otra. En una plataforma multiempresa eso es una fuga entre inquilinos.
--
-- Estas dos columnas mueven ese identificador a la fila de la conexión, y el
-- UNIQUE convierte «una cuenta externa pertenece a UNA empresa» en una regla
-- que impone la base, no en una convención que alguien recuerde.
--
-- 100% ADITIVA. Dos columnas anulables y sin default: en PostgreSQL 11+ eso es
-- un cambio de METADATOS —no reescribe la tabla, no toca una fila en disco—.
-- Sin UPDATE, sin backfill, sin borrar nada. Idempotente.
-- ============================================================================

ALTER TABLE "conexiones_empresa" ADD COLUMN IF NOT EXISTS "cuentaExterna" TEXT;
ALTER TABLE "conexiones_empresa" ADD COLUMN IF NOT EXISTS "recursoExterno" TEXT;

-- ── El UNIQUE, creado SIN bloquear la tabla ─────────────────────────────────
--
-- `CONCURRENTLY` es deliberado y es la lección del CHECK de la Fase 10: un
-- índice único normal toma un lock que impide ESCRIBIR en la tabla mientras se
-- construye. Aquí no se notaría (la tabla es pequeña), pero el hábito no puede
-- depender del tamaño — el día que se aplique sobre una tabla con volumen, la
-- diferencia es una caída.
--
-- NULL no colisiona con NULL en PostgreSQL, así que las conexiones que no
-- tengan cuenta externa (Google Calendar, CardNET) conviven sin problema.
--
-- ⚠ IMPORTANTE AL EJECUTARLO A MANO: `CONCURRENTLY` NO PUEDE correr dentro de
-- una transacción. Si el editor SQL envuelve todo el archivo en una, esta
-- línea fallará con «CREATE INDEX CONCURRENTLY cannot run inside a
-- transaction block». En ese caso, ejecute ESTA sentencia sola, en su propia
-- pestaña, y después el resto del archivo.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
  "conexiones_empresa_conectorId_cuentaExterna_key"
  ON "conexiones_empresa" ("conectorId", "cuentaExterna");

-- ── Verificación ────────────────────────────────────────────────────────────

SELECT 'connect_identidad_externa' AS objeto,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_name = 'conexiones_empresa'
           AND column_name IN ('cuentaExterna','recursoExterno')) AS columnas,
       (SELECT count(*) FROM pg_indexes
         WHERE tablename = 'conexiones_empresa'
           AND indexname = 'conexiones_empresa_conectorId_cuentaExterna_key') AS indice,
       CASE WHEN (SELECT count(*) FROM information_schema.columns
                   WHERE table_name = 'conexiones_empresa'
                     AND column_name IN ('cuentaExterna','recursoExterno')) = 2
             AND (SELECT count(*) FROM pg_indexes
                   WHERE tablename = 'conexiones_empresa'
                     AND indexname = 'conexiones_empresa_conectorId_cuentaExterna_key') = 1
            THEN 'OK' ELSE 'FALTA' END AS estado;

-- ── Diagnóstico ─────────────────────────────────────────────────────────────
-- Ninguna conexión existente tiene cuenta externa: se rellena al conectar.
SELECT 'conexiones_sin_cuenta_externa' AS objeto, count(*) AS cuantas
  FROM conexiones_empresa WHERE "cuentaExterna" IS NULL;
