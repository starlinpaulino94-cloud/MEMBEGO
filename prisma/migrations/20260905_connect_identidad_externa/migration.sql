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

-- ── El UNIQUE ───────────────────────────────────────────────────────────────
--
-- ÍNDICE NORMAL, no `CONCURRENTLY`, y conviene dejar escrito por qué se
-- cambió: `CONCURRENTLY` no puede ejecutarse dentro de una transacción, y el
-- editor SQL de Supabase envuelve lo que se le pega en una. Obligaba a partir
-- el archivo a mano, y encima tiene un modo de fallo peor para quien aplica
-- SQL a mano: si se interrumpe a medias deja un índice INVÁLIDO que hay que
-- localizar y borrar.
--
-- Aquí no aporta nada: `conexiones_empresa` tiene un puñado de filas y el
-- bloqueo es de milisegundos.
--
-- ⚠ CUÁNDO SÍ HARÍA FALTA: sobre una tabla con volumen (clientes, pagos), un
-- índice único normal bloquea las ESCRITURAS mientras se construye. Ahí se usa
-- `CREATE UNIQUE INDEX CONCURRENTLY`, se ejecuta SOLO, en su propia pestaña, y
-- se comprueba después con `SELECT indisvalid FROM pg_index ...`.
--
-- NULL no colisiona con NULL en PostgreSQL, así que las conexiones sin cuenta
-- externa (Google Calendar, CardNET) conviven sin problema.
CREATE UNIQUE INDEX IF NOT EXISTS
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
