-- ─────────────────────────────────────────────────────────────────────────────
-- `visits.companyId` — VERSIÓN PARA PRODUCCIÓN (lotes + CONCURRENTLY).
--
-- POR QUÉ ESTE ARCHIVO EXISTE APARTE DE LA MIGRACIÓN
--
-- La migración `20260919_visitas_company_id` añade la columna y crea los dos
-- índices con un `CREATE INDEX` normal, porque `CONCURRENTLY` no puede correr
-- dentro de una transacción y Prisma envuelve cada migración en una. Con la
-- versión normal, `prisma migrate diff` reproduce el historial y el CI puede
-- comprobar que el esquema no tiene cambios sin migración.
--
-- El precio de un `CREATE INDEX` normal es que BLOQUEA LAS ESCRITURAS de la
-- tabla mientras construye. En una base vacía es instantáneo; en producción, con
-- millones de visitas, es dejar el escáner de la pista sin registrar nada
-- durante minutos. Lo mismo, y peor, con un `UPDATE` de una sola sentencia: un
-- solo `UPDATE` sobre toda la tabla toma millones de locks de fila, infla el
-- WAL y bloquea a quien intente escribir encima. Por eso va POR LOTES.
--
-- ⚠ ANTES DE NADA: MIRA EL TAMAÑO DE LA TABLA.
--
--   SELECT count(*) FROM "visits";
--
-- Todo el aparato de este archivo —lotes, `CONCURRENTLY`, un cliente externo—
-- defiende de un bloqueo que solo existe con volumen. Con unos cientos de miles
-- de filas o menos no defiende de nada y solo complica: usa
-- `2026-09-visitas-company-id-BASE-PEQUENA.sql`, que hace lo mismo de una
-- pasada y corre entero en el editor de Supabase.
--
-- El 14-09-2026, la producción de MEMBEGO tenía 130 visitas. Este archivo es
-- para el día que sean millones, que el modelo prevé pero todavía no son.
--
-- ORDEN DE EJECUCIÓN EN PRODUCCIÓN
--
--   PASO 1 · añadir la columna              (rápido, no reescribe la tabla)
--   PASO 2 · rellenar por lotes             (repetir hasta que dé 0)
--   PASO 3 · crear los índices CONCURRENTLY
--   PASO 4 · verificar
--
-- Cuando la migración de Prisma corra después, su `ADD COLUMN IF NOT EXISTS` y
-- sus `CREATE INDEX IF NOT EXISTS` no harán nada, porque ya estará todo.
--
-- CÓMO EJECUTARLO — Y DÓNDE, QUE NO ES LO MISMO PARA TODOS LOS PASOS
--
-- Los pasos 1, 2 y 4 van en el SQL Editor de Supabase sin problema.
--
-- EL PASO 3 NO PUEDE EJECUTARSE EN EL SQL EDITOR DE SUPABASE. El editor
-- envuelve en una transacción TODO lo que le mandas —no solo cuando pegas
-- varias sentencias—, y `CREATE INDEX CONCURRENTLY` no puede correr dentro de
-- una. Devuelve `ERROR: 25001: CREATE INDEX CONCURRENTLY cannot run inside a
-- transaction block`, y no hay forma de evitarlo desde ahí. Este archivo decía
-- «una sentencia a la vez» heredándolo de
-- `2026-07-visitas-indices-concurrently.sql`; era falso, y se corrigió cuando
-- el error apareció de verdad.
--
-- Hay dos salidas, y la primera es casi siempre la buena:
--
--   A · SI LA TABLA ES PEQUEÑA, NO HACE FALTA `CONCURRENTLY`. Mira primero
--       cuántas filas hay (la consulta está al final del paso 2). Con unos
--       pocos cientos de miles, un `CREATE INDEX` normal tarda menos de un
--       segundo y el bloqueo de escrituras no lo nota nadie. En ese caso NO
--       ejecutes el paso 3: deja que lo haga la migración de Prisma
--       `20260919_visitas_company_id`, que crea los mismos dos índices sin
--       `CONCURRENTLY`. No tienes que hacer nada más.
--
--   B · SI LA TABLA YA ES GRANDE, hace falta un cliente que NO envuelva en
--       transacción. `psql` sirve, que va en autocommit por defecto:
--
--         psql "<cadena de conexión de Supabase>" -f este-archivo.sql
--
--       (sin `-1` ni `--single-transaction`, que es justo lo que lo rompería).
--       Cualquier cliente de escritorio —TablePlus, DBeaver, pgAdmin— vale
--       igual, siempre que la sesión esté en autocommit.
--
-- SE PUEDE PARAR A MEDIAS. El paso 2 es idempotente y reanudable: solo toca
-- filas con `companyId IS NULL`. Mientras queden, el reporte de operación avisa
-- en pantalla y en el CSV de que su cobertura es parcial — no las enseña como
-- cero en silencio.
-- ─────────────────────────────────────────────────────────────────────────────


-- ── PASO 1 · la columna ─────────────────────────────────────────────────────
-- `ADD COLUMN` de una columna NULLABLE y SIN default no reescribe la tabla:
-- Postgres solo toca el catálogo. Es instantáneo incluso con millones de filas.
-- Una columna NOT NULL con default sí la reescribiría, y por eso no se usa.

ALTER TABLE "visits" ADD COLUMN IF NOT EXISTS "companyId" TEXT;


-- ── PASO 2 · el relleno, por lotes ──────────────────────────────────────────
-- EJECUTA ESTA SENTENCIA UNA Y OTRA VEZ hasta que el resultado diga 0 filas.
-- Cada pasada toca como mucho 20.000 visitas y dura un par de segundos; entre
-- pasada y pasada la tabla queda libre para las escrituras del escáner.
--
-- El valor sale de la membresía, que es de donde se copia también al crear una
-- visita nueva: así el dato histórico y el nuevo significan exactamente lo
-- mismo. `m."companyId"` es NOT NULL en `memberships`, así que ninguna fila
-- alcanzada por el lote puede quedarse en null por esta vía.

UPDATE "visits" v
   SET "companyId" = m."companyId"
  FROM "memberships" m
 WHERE v."id" IN (
         SELECT "id" FROM "visits"
          WHERE "companyId" IS NULL
          LIMIT 20000
       )
   AND m."id" = v."membershipId";

-- Cuántas quedan. Cuando esto dé 0, el paso 2 terminó.
SELECT count(*) AS visitas_sin_empresa FROM "visits" WHERE "companyId" IS NULL;


-- ── PASO 3 · los índices, sin bloquear ──────────────────────────────────────
--
-- ESTE PASO NO CORRE EN EL SQL EDITOR DE SUPABASE (error 25001). Lee arriba:
-- con la tabla pequeña, sáltatelo y deja que los cree la migración de Prisma;
-- con la tabla grande, ejecútalo desde `psql` u otro cliente en autocommit.

CREATE INDEX CONCURRENTLY IF NOT EXISTS "visits_companyId_fechaVisita_idx"
  ON "visits" ("companyId", "fechaVisita");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "audit_logs_companyId_accion_createdAt_idx"
  ON "audit_logs" ("companyId", "accion", "createdAt");


-- ── PASO 4 · verificación ───────────────────────────────────────────────────
-- Las dos filas deben decir true. Un índice en estado "invalid" —por una
-- construcción concurrente interrumpida— hay que borrarlo (`DROP INDEX
-- CONCURRENTLY`) y rehacerlo: existe, pero el planificador no lo usa.

-- `relname` y no `indexrelid::regclass`: con un nombre en mayúsculas y
-- minúsculas, el cast devuelve el identificador ENTRECOMILLADO y la comparación
-- con el texto de abajo nunca casa — la consulta saldría con cero filas y
-- parecería que los índices no existen.
SELECT c.relname AS indice, i.indisvalid AS valido
  FROM pg_index i
  JOIN pg_class c ON c.oid = i.indexrelid
 WHERE c.relname IN (
         'visits_companyId_fechaVisita_idx',
         'audit_logs_companyId_accion_createdAt_idx'
       );

-- Y la cobertura, que es lo que el reporte enseña. `pendientes` en 0 significa
-- que el reporte de operación ya cubre todo el histórico y deja de avisar.
SELECT count(*) FILTER (WHERE "companyId" IS NULL) AS pendientes,
       count(*)                                    AS total
  FROM "visits";
