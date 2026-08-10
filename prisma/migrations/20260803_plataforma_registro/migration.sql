-- ============================================================================
-- PLATAFORMA · Fase 1b — Registro de sistemas, tipos de negocio y habilitaciones
-- ============================================================================
-- Ver docs/platform/registro.md y docs/PLATFORM_ARCHITECTURE_REPORT.md §5–§7.
--
-- QUÉ RESUELVE
--
-- Hoy el acceso de una empresa a un sistema satélite se decide comparando dos
-- cadenas: `sistemas_conectados.categoria = <categoría de la empresa>`. Eso
-- tiene tres consecuencias que no se ven hasta que hay más de un vertical:
--
--   1. Un sistema atiende UNA categoría. Un POS que sirva a restaurante y a
--      barbería no se puede representar.
--   2. Registrar un sistema se lo concede DE GOLPE a todas las empresas de su
--      categoría. No hay forma de decir «este restaurante sí, aquel no».
--   3. `activo BOOLEAN` no distingue «aún no lanzado» de «suspendido por
--      incidente» de «retirado».
--
-- MIGRACIÓN EXPANSIVA: se añade lo nuevo y se rellena; NO se borra nada.
-- `categoria` y `activo` siguen existiendo y siguen siendo correctos. La
-- retirada de esas dos columnas es una fase posterior, cuando ya no queden
-- despliegues antiguos que las lean.
--
-- COMPATIBILIDAD (la parte que importa): al terminar, toda empresa que HOY
-- accede a un sistema por categoría tiene una habilitación ENABLED explícita, y
-- todo sistema existente queda con `autoHabilitar = true`. Nadie pierde acceso
-- el día del cambio ni el día después.
--
-- Idempotente: se puede correr varias veces sin efecto.
-- ============================================================================

-- ── 1 · Catálogo de tipos de negocio ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "tipos_negocio" (
    "id"          TEXT NOT NULL,
    "codigo"      TEXT NOT NULL,
    "nombre"      TEXT NOT NULL,
    "descripcion" TEXT,
    "icono"       TEXT,
    "orden"       INTEGER NOT NULL DEFAULT 0,
    "activo"      BOOLEAN NOT NULL DEFAULT true,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tipos_negocio_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "tipos_negocio_codigo_key" ON "tipos_negocio"("codigo");

-- ── 2 · Qué verticales atiende cada sistema (N:M) ───────────────────────────
CREATE TABLE IF NOT EXISTS "sistemas_tipos_negocio" (
    "sistemaId" TEXT NOT NULL,
    "tipoId"    TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sistemas_tipos_negocio_pkey" PRIMARY KEY ("sistemaId","tipoId")
);
CREATE INDEX IF NOT EXISTS "sistemas_tipos_negocio_tipoId_idx" ON "sistemas_tipos_negocio"("tipoId");

DO $$ BEGIN ALTER TABLE "sistemas_tipos_negocio" ADD CONSTRAINT "sistemas_tipos_negocio_sistemaId_fkey"
  FOREIGN KEY ("sistemaId") REFERENCES "sistemas_conectados"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "sistemas_tipos_negocio" ADD CONSTRAINT "sistemas_tipos_negocio_tipoId_fkey"
  FOREIGN KEY ("tipoId") REFERENCES "tipos_negocio"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 3 · Habilitaciones (entitlements) por empresa ───────────────────────────
CREATE TABLE IF NOT EXISTS "empresas_sistemas" (
    "id"              TEXT NOT NULL,
    "companyId"       TEXT NOT NULL,
    "sistemaId"       TEXT NOT NULL,
    "estado"          TEXT NOT NULL DEFAULT 'AVAILABLE',
    "habilitadoAt"    TIMESTAMP(3),
    "deshabilitadoAt" TIMESTAMP(3),
    "plan"            TEXT,
    "configuracion"   JSONB,
    "metadata"        JSONB,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,
    CONSTRAINT "empresas_sistemas_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "empresas_sistemas_companyId_sistemaId_key" ON "empresas_sistemas"("companyId","sistemaId");
CREATE INDEX IF NOT EXISTS "empresas_sistemas_companyId_estado_idx" ON "empresas_sistemas"("companyId","estado");
CREATE INDEX IF NOT EXISTS "empresas_sistemas_sistemaId_estado_idx" ON "empresas_sistemas"("sistemaId","estado");

DO $$ BEGIN ALTER TABLE "empresas_sistemas" ADD CONSTRAINT "empresas_sistemas_sistemaId_fkey"
  FOREIGN KEY ("sistemaId") REFERENCES "sistemas_conectados"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 4 · Ciclo de vida del sistema ───────────────────────────────────────────
--
-- Las dos columnas se añaden JUNTAS dentro del mismo guard, y el relleno va
-- dentro también: así corre exactamente una vez —cuando las columnas nacen— y
-- una segunda ejecución no puede volver a poner `autoHabilitar = true` sobre un
-- sistema registrado después con la política nueva (opt-in).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sistemas_conectados' AND column_name = 'estado'
  ) THEN
    ALTER TABLE "sistemas_conectados" ADD COLUMN "estado" TEXT NOT NULL DEFAULT 'ACTIVE';
    ALTER TABLE "sistemas_conectados" ADD COLUMN "autoHabilitar" BOOLEAN NOT NULL DEFAULT false;

    -- Un sistema apagado hoy es un sistema SUSPENDIDO: DRAFT y RETIRED son
    -- estados que nadie pudo declarar todavía, así que no se pueden adivinar.
    UPDATE "sistemas_conectados"
       SET "estado"        = CASE WHEN "activo" THEN 'ACTIVE' ELSE 'SUSPENDED' END,
           "autoHabilitar" = true;
  END IF;
END $$;

-- `activo` deja de ser la verdad y pasa a ser un espejo de `estado`. Mientras
-- la columna exista, este CHECK impide que los dos valores se separen: si algún
-- día alguien hace `UPDATE ... SET activo = false` a mano, la sentencia falla en
-- vez de dejar la fila diciendo dos cosas distintas.
DO $$ BEGIN ALTER TABLE "sistemas_conectados"
  ADD CONSTRAINT "sistemas_conectados_estado_activo_coherentes"
  CHECK (("estado" = 'ACTIVE') = "activo");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "sistemas_conectados"
  ADD CONSTRAINT "sistemas_conectados_estado_valido"
  CHECK ("estado" IN ('DRAFT','ACTIVE','SUSPENDED','RETIRED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "empresas_sistemas"
  ADD CONSTRAINT "empresas_sistemas_estado_valido"
  CHECK ("estado" IN ('AVAILABLE','ENABLED','DISABLED','SUSPENDED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 5 · Semilla del catálogo ────────────────────────────────────────────────
-- Los cuatro valores del `as const` de `modules/capacidades/catalogo.ts`, con
-- las mismas etiquetas que ya muestra el panel. El `as const` NO desaparece:
-- sigue siendo la semilla y el tipo derivado.
INSERT INTO "tipos_negocio" ("id","codigo","nombre","orden","activo","createdAt","updatedAt")
VALUES
  (gen_random_uuid()::text, 'CAR_WASH',    'Car Wash',           1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'BARBERIA',    'Barbería / Salón',   2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'RESTAURANTE', 'Restaurante',        3, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'GYM',         'Gimnasio',           4, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("codigo") DO NOTHING;

-- Red de seguridad: `sistemas_conectados.categoria` es texto libre. Si alguna
-- fila apunta a una categoría que no está en la semilla, se crea el tipo en vez
-- de dejar ese sistema sin ningún vertical compatible — que es exactamente
-- cómo se pierde acceso sin que nadie se entere.
INSERT INTO "tipos_negocio" ("id","codigo","nombre","orden","activo","createdAt","updatedAt")
SELECT gen_random_uuid()::text, s."categoria", s."categoria", 99, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "categoria" FROM "sistemas_conectados" WHERE "categoria" <> '') s
ON CONFLICT ("codigo") DO NOTHING;

-- ── 6 · Traspaso de la categoría única a la relación N:M ────────────────────
INSERT INTO "sistemas_tipos_negocio" ("sistemaId","tipoId","createdAt")
SELECT s."id", t."id", CURRENT_TIMESTAMP
FROM "sistemas_conectados" s
JOIN "tipos_negocio" t ON t."codigo" = s."categoria"
ON CONFLICT DO NOTHING;

-- ── 7 · Compatibilidad: habilitar a quien ya tenía acceso ───────────────────
--
-- La categoría efectiva de una empresa se calcula igual que en el código
-- (`capacidadesEfectivas` → `resolverConfig` + `categoriaDeType`): override
-- validado en `capacidades.categoria`, si no el `type` heredado, y CAR_WASH
-- como fallback — el mismo fail-open que ya rige en producción.
--
-- Estas filas son redundantes con `autoHabilitar = true`… hoy. Dejan de serlo
-- en cuanto alguien apague esa política para hacer el vertical opt-in: sin
-- filas explícitas, ese cambio revocaría en silencio el acceso de todas las
-- empresas existentes.
WITH categoria_empresa AS (
  SELECT
    c."id" AS company_id,
    CASE
      WHEN c."capacidades"->>'categoria' IN ('CAR_WASH','BARBERIA','RESTAURANTE','GYM')
           THEN c."capacidades"->>'categoria'
      WHEN lower(coalesce(c."type",'')) = 'restaurante'          THEN 'RESTAURANTE'
      WHEN lower(coalesce(c."type",'')) IN ('barberia','salon')  THEN 'BARBERIA'
      WHEN lower(coalesce(c."type",'')) IN ('gym','gimnasio')    THEN 'GYM'
      ELSE 'CAR_WASH'
    END AS codigo
  FROM "companies" c
)
INSERT INTO "empresas_sistemas"
  ("id","companyId","sistemaId","estado","habilitadoAt","createdAt","updatedAt")
SELECT
  gen_random_uuid()::text, ce.company_id, stn."sistemaId", 'ENABLED',
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM categoria_empresa ce
JOIN "tipos_negocio" t          ON t."codigo" = ce.codigo
JOIN "sistemas_tipos_negocio" stn ON stn."tipoId" = t."id"
ON CONFLICT ("companyId","sistemaId") DO NOTHING;

-- ── 8 · Verificación ────────────────────────────────────────────────────────
-- Un sistema sin ningún tipo de negocio es un sistema al que nadie puede
-- entrar: si esta columna no dice 0, la migración perdió acceso por el camino.
SELECT 'plataforma_registro'                                        AS objeto,
       (SELECT count(*) FROM "tipos_negocio")                       AS tipos_negocio,
       (SELECT count(*) FROM "sistemas_conectados")                 AS sistemas,
       (SELECT count(*) FROM "sistemas_tipos_negocio")              AS sistema_tipo,
       (SELECT count(*) FROM "empresas_sistemas" WHERE "estado" = 'ENABLED') AS habilitaciones,
       (SELECT count(*) FROM "sistemas_conectados" s
         WHERE NOT EXISTS (SELECT 1 FROM "sistemas_tipos_negocio" x WHERE x."sistemaId" = s."id")
       )                                                            AS sistemas_sin_vertical;
