-- Índices compuestos para `visits` (auditoría de producción · A-05).
--
-- `visits` es la tabla de mayor crecimiento del sistema: una fila por escaneo,
-- del orden de millones al mes con el volumen previsto. No tiene `companyId`
-- —se llega por la membresía—, así que todo reporte de empresa por rango de
-- fechas entra por `membershipId` y filtra por `fechaVisita`, y el historial
-- del cliente hace lo mismo por `clienteId`.
--
-- Con los índices sueltos que ya existían, PostgreSQL elige uno y descarta el
-- resto de filas leyéndolas; con el compuesto resuelve las dos condiciones en
-- una sola pasada del índice.
--
-- ADITIVA: solo añade índices. CONCURRENTLY para no bloquear escrituras
-- mientras se construyen — importante si la tabla ya tiene volumen.
--
-- OJO: `CREATE INDEX CONCURRENTLY` NO puede correr dentro de una transacción.
-- En el SQL Editor de Supabase ejecuta cada sentencia POR SEPARADO (una, y
-- cuando termine, la otra). Si da "cannot run inside a transaction block", es
-- justo eso.

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
