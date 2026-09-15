-- ─────────────────────────────────────────────────────────────────────────────
-- `visits.companyId` — VERSIÓN PARA UNA BASE PEQUEÑA. TODO EN UNA PASADA.
--
-- CUÁNDO USAR ESTE Y NO `2026-09-visitas-company-id.sql`
--
-- Cuando `visits` tiene pocas filas. Se comprobó el 14-09-2026 y la producción
-- de MEMBEGO tenía 130 visitas y 1.365 entradas de bitácora: a ese tamaño, todo
-- el aparato de lotes e índices `CONCURRENTLY` del otro archivo no defiende de
-- nada. Un `UPDATE` de 130 filas y un `CREATE INDEX` normal son instantáneos, y
-- el bloqueo de escrituras que tanto se cuida dura menos de lo que tarda en
-- llegar el siguiente escaneo.
--
-- El otro archivo NO sobra: sigue siendo el bueno el día que la tabla crezca —el
-- modelo prevé «del orden de millones al mes»—. Lo que no hay que hacer es
-- pagar hoy una complicación por un problema que todavía no existe.
--
-- MIRA PRIMERO EL TAMAÑO. Si `visits` pasó de unos cientos de miles, cierra
-- este archivo y usa el otro.
--
--   SELECT count(*) FROM "visits";
--
-- SE EJECUTA ENTERO, DE UNA VEZ, EN EL SQL EDITOR DE SUPABASE. No lleva
-- `CONCURRENTLY`, que es justo lo que el editor no puede correr.
--
-- ES IDEMPOTENTE: el `UPDATE` solo toca lo que está en null y los índices van
-- con `IF NOT EXISTS`. Ejecutarlo dos veces no hace nada la segunda.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1 · La columna ──────────────────────────────────────────────────────────
-- Nullable y sin default: no reescribe la tabla, solo toca el catálogo.
ALTER TABLE "visits" ADD COLUMN IF NOT EXISTS "companyId" TEXT;

-- ── 2 · El relleno ──────────────────────────────────────────────────────────
-- Sin lotes: a este tamaño no hacen falta. El valor sale de la membresía, que
-- es de donde se copia también al crear una visita nueva, así que el dato
-- histórico y el nuevo significan exactamente lo mismo.
UPDATE "visits" v
   SET "companyId" = m."companyId"
  FROM "memberships" m
 WHERE v."companyId" IS NULL
   AND m."id" = v."membershipId";

-- ── 3 · Los índices ─────────────────────────────────────────────────────────
-- El de `visits` es el que justifica la columna: todo reporte de operación es
-- «esta empresa, entre estas dos fechas».
CREATE INDEX IF NOT EXISTS "visits_companyId_fechaVisita_idx"
  ON "visits" ("companyId", "fechaVisita");

-- El de la bitácora, para los QR generados y usados por empresa y fecha.
CREATE INDEX IF NOT EXISTS "audit_logs_companyId_accion_createdAt_idx"
  ON "audit_logs" ("companyId", "accion", "createdAt");

-- ── 4 · Verificación ────────────────────────────────────────────────────────
-- `pendientes` tiene que dar 0. Mientras no lo dé, el reporte de operación
-- avisa de que su cobertura es parcial en vez de enseñar cifras cortas en
-- silencio.
SELECT count(*) FILTER (WHERE "companyId" IS NULL) AS pendientes,
       count(*)                                    AS total,
       count(DISTINCT "companyId")                 AS empresas
  FROM "visits";

-- Los dos índices, presentes y válidos. `relname` y no `indexrelid::regclass`:
-- con un nombre en mayúsculas y minúsculas el cast devuelve el identificador
-- entrecomillado y la comparación no casa nunca.
SELECT c.relname AS indice, i.indisvalid AS valido
  FROM pg_index i
  JOIN pg_class c ON c.oid = i.indexrelid
 WHERE c.relname IN ('visits_companyId_fechaVisita_idx',
                     'audit_logs_companyId_accion_createdAt_idx')
 ORDER BY 1;
