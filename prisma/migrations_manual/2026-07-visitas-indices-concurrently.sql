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
-- CÓMO EJECUTARLO: en el SQL Editor de Supabase, UNA SENTENCIA A LA VEZ. Si
-- pegas el archivo entero te dirá "cannot run inside a transaction block".
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
