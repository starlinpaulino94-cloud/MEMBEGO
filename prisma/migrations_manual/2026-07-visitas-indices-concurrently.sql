-- ─────────────────────────────────────────────────────────────────────────────
-- Índices compuestos de `visits` — VERSIÓN PARA PRODUCCIÓN (CONCURRENTLY).
--
-- POR QUÉ ESTE ARCHIVO EXISTE APARTE DE LA MIGRACIÓN
--
-- La migración `20260768_visitas_indices` crea estos mismos dos índices con un
-- `CREATE INDEX` normal, porque `CONCURRENTLY` no puede ejecutarse dentro de
-- una transacción y Prisma envuelve cada migración en una. Con la versión
-- normal, `prisma migrate diff` puede reproducir el historial y el CI puede
-- comprobar que el esquema no tiene cambios sin migración.
--
-- El precio de un `CREATE INDEX` normal es que BLOQUEA LAS ESCRITURAS de la
-- tabla mientras construye el índice. En una base vacía (CI, entorno nuevo) eso
-- es instantáneo y da igual. En producción, con millones de visitas, sería
-- dejar el escáner de la pista sin registrar nada durante minutos.
--
-- POR ESO, EN PRODUCCIÓN: ejecuta ESTE archivo PRIMERO. Cuando la migración
-- corra después, sus `CREATE INDEX IF NOT EXISTS` no harán nada porque los
-- índices ya estarán.
--
-- CÓMO EJECUTARLO — CORREGIDO
--
-- Este archivo decía que bastaba con lanzar las sentencias de una en una desde
-- el SQL Editor de Supabase. ES FALSO, y se descubrió al intentarlo con el
-- archivo hermano
-- `2026-09-visitas-company-id.sql`: el editor de Supabase envuelve en una
-- transacción TODO lo que le mandas, una sentencia o veinte, así que
-- `CONCURRENTLY` devuelve siempre `ERROR: 25001: CREATE INDEX CONCURRENTLY
-- cannot run inside a transaction block`.
--
-- Hace falta un cliente en autocommit. `psql` lo está por defecto:
--
--   psql "<cadena de conexión de Supabase>" -f este-archivo.sql
--
-- (sin `-1` ni `--single-transaction`). Cualquier cliente de escritorio
-- —TablePlus, DBeaver, pgAdmin— vale igual con la sesión en autocommit.
--
-- Y ANTES DE NADA: mira cuántas filas tiene la tabla. Si son pocos cientos de
-- miles, un `CREATE INDEX` normal tarda menos de un segundo y este archivo
-- sobra — deja que los cree la migración y no ejecutes nada de aquí.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX CONCURRENTLY IF NOT EXISTS "visits_membershipId_fechaVisita_idx"
  ON "visits" ("membershipId", "fechaVisita");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "visits_clienteId_fechaVisita_idx"
  ON "visits" ("clienteId", "fechaVisita");

-- ── Verificación ───────────────────────────────────────────────────────────
-- Ambas filas deben decir true. Un índice en estado "invalid" (por una
-- construcción concurrente interrumpida) hay que borrarlo y rehacerlo.
SELECT indexname, indisvalid
  FROM pg_indexes
  JOIN pg_class ON pg_class.relname = pg_indexes.indexname
  JOIN pg_index ON pg_index.indexrelid = pg_class.oid
 WHERE tablename = 'visits'
   AND indexname IN ('visits_membershipId_fechaVisita_idx', 'visits_clienteId_fechaVisita_idx');
