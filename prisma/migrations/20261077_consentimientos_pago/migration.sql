-- Consentimientos sobre la tarjeta guardada (`consentimientos_pago`).
--
-- GUARDAR la tarjeta y RENOVAR automáticamente son dos consentimientos distintos
-- con dos operaciones distintas: el primero permite pagos que el cliente inicia;
-- el segundo permite cobros SIN él. Hasta ahora no quedaba registro de ninguno
-- salvo una marca de fecha (`consentimientoGuardadoAt`) en la tarjeta.
--
-- Idempotente: se puede volver a correr (por ejemplo pegada en el SQL Editor)
-- sin duplicar nada. Aditiva: no toca ninguna columna existente.

-- ─── 1. La tabla ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "consentimientos_pago" (
    "id"           TEXT         NOT NULL,
    "companyId"    TEXT         NOT NULL,
    "clienteId"    TEXT         NOT NULL,
    "tipo"         TEXT         NOT NULL,
    "tarjetaId"    TEXT,
    "membershipId" TEXT,
    "origen"       TEXT         NOT NULL DEFAULT 'CLIENTE',
    "textoVersion" TEXT         NOT NULL,
    "otorgadoAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revocadoAt"   TIMESTAMP(3),
    "ipAddress"    TEXT,
    "userAgent"    TEXT,

    CONSTRAINT "consentimientos_pago_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "consentimientos_pago_companyId_idx"
  ON "consentimientos_pago" ("companyId");
CREATE INDEX IF NOT EXISTS "consentimientos_pago_clienteId_tipo_revocadoAt_idx"
  ON "consentimientos_pago" ("clienteId", "tipo", "revocadoAt");
CREATE INDEX IF NOT EXISTS "consentimientos_pago_tarjetaId_idx"
  ON "consentimientos_pago" ("tarjetaId");
CREATE INDEX IF NOT EXISTS "consentimientos_pago_membershipId_tipo_idx"
  ON "consentimientos_pago" ("membershipId", "tipo");

-- Claves foráneas. Las de empresa y cliente borran en cascada (si desaparece el
-- cliente, desaparece su rastro). Las de tarjeta y membresía NO: el
-- consentimiento sobrevive a la tarjeta o a la membresía que quitó el cliente,
-- porque es justo lo que hay que poder enseñar después.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'consentimientos_pago_companyId_fkey') THEN
    ALTER TABLE "consentimientos_pago"
      ADD CONSTRAINT "consentimientos_pago_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'consentimientos_pago_clienteId_fkey') THEN
    ALTER TABLE "consentimientos_pago"
      ADD CONSTRAINT "consentimientos_pago_clienteId_fkey"
      FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'consentimientos_pago_tarjetaId_fkey') THEN
    ALTER TABLE "consentimientos_pago"
      ADD CONSTRAINT "consentimientos_pago_tarjetaId_fkey"
      FOREIGN KEY ("tarjetaId") REFERENCES "tarjetas_tokenizadas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'consentimientos_pago_membershipId_fkey') THEN
    ALTER TABLE "consentimientos_pago"
      ADD CONSTRAINT "consentimientos_pago_membershipId_fkey"
      FOREIGN KEY ("membershipId") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Los valores válidos. El código los valida también; esto es la segunda barrera
-- (Prisma no sabe de CHECK, así que no genera deriva).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'consentimientos_pago_tipo_chk') THEN
    ALTER TABLE "consentimientos_pago"
      ADD CONSTRAINT "consentimientos_pago_tipo_chk"
      CHECK ("tipo" IN ('GUARDAR_TARJETA', 'RENOVACION_AUTOMATICA'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'consentimientos_pago_origen_chk') THEN
    ALTER TABLE "consentimientos_pago"
      ADD CONSTRAINT "consentimientos_pago_origen_chk"
      CHECK ("origen" IN ('CLIENTE', 'HEREDADO'));
  END IF;
END $$;

-- ─── 2. Consentimientos HEREDADOS ───────────────────────────────────────────
--
-- Lo que ya estaba guardado se guardó ANTES de que existiera este registro, y
-- no hay constancia del texto exacto que se le mostró a cada cliente. Se marcan
-- `origen = 'HEREDADO'` y `textoVersion = 'previo-a-registro'`: fingir lo
-- contrario sería fabricar evidencia, y marcarlos así permite pedir una
-- reconfirmación más adelante.
--
-- Importa sobre todo el de RENOVAR: el cobro automático empieza a exigir un
-- consentimiento vigente, y sin esta herencia las renovaciones que HOY funcionan
-- se detendrían el día que se despliegue el código.

-- 2a. Guardar la tarjeta: una por tarjeta activa. La fecha es la de
-- `consentimientoGuardadoAt` si la hay (el cliente lo aceptó explícitamente) y
-- la de creación si no.
INSERT INTO "consentimientos_pago"
  ("id", "companyId", "clienteId", "tipo", "tarjetaId", "membershipId",
   "origen", "textoVersion", "otorgadoAt")
SELECT gen_random_uuid()::text, t."companyId", t."clienteId", 'GUARDAR_TARJETA',
       t."id", NULL, 'HEREDADO', 'previo-a-registro',
       COALESCE(t."consentimientoGuardadoAt", t."createdAt")
  FROM "tarjetas_tokenizadas" t
 WHERE t."activa"
   AND NOT EXISTS (
     SELECT 1 FROM "consentimientos_pago" c
      WHERE c."tarjetaId" = t."id"
        AND c."tipo" = 'GUARDAR_TARJETA'
        AND c."membershipId" IS NULL
        AND c."revocadoAt" IS NULL
   );

-- 2b. Renovar automáticamente: una por membresía que hoy renueva sola con una
-- tarjeta activa. La fecha es la de creación de la tarjeta, que es cuando se le
-- mostró la casilla: una aproximación, y la mejor que hay.
INSERT INTO "consentimientos_pago"
  ("id", "companyId", "clienteId", "tipo", "tarjetaId", "membershipId",
   "origen", "textoVersion", "otorgadoAt")
SELECT gen_random_uuid()::text, t."companyId", t."clienteId", 'RENOVACION_AUTOMATICA',
       t."id", m."id", 'HEREDADO', 'previo-a-registro', t."createdAt"
  FROM "memberships" m
  JOIN "tarjetas_tokenizadas" t ON t."id" = m."tarjetaTokenizadaId" AND t."activa"
 WHERE m."autoRenovar"
   AND NOT EXISTS (
     SELECT 1 FROM "consentimientos_pago" c
      WHERE c."membershipId" = m."id"
        AND c."tipo" = 'RENOVACION_AUTOMATICA'
        AND c."revocadoAt" IS NULL
   );

-- ─── 3. Índices únicos parciales ────────────────────────────────────────────
--
-- Después de rellenar, para que su creación no pueda fallar. Prisma no expresa
-- índices parciales: viven solo aquí.

-- Un consentimiento de guardar vigente por tarjeta…
CREATE UNIQUE INDEX IF NOT EXISTS "consentimientos_pago_vigente_tarjeta_uk"
  ON "consentimientos_pago" ("tipo", "tarjetaId")
  WHERE "revocadoAt" IS NULL AND "membershipId" IS NULL AND "tarjetaId" IS NOT NULL;

-- …y uno de renovar vigente por membresía.
CREATE UNIQUE INDEX IF NOT EXISTS "consentimientos_pago_vigente_membresia_uk"
  ON "consentimientos_pago" ("tipo", "membershipId")
  WHERE "revocadoAt" IS NULL AND "membershipId" IS NOT NULL;

-- ─── 4. RLS ─────────────────────────────────────────────────────────────────
--
-- Sin política, RLS deniega a todo rol que no la bypasee. La aplicación se
-- conecta como `postgres` (BYPASSRLS), así que hoy no cambia nada; la Capa 2
-- deduce la política de `companyId` cuando se aplique. Ver docs/RLS.md.
ALTER TABLE "consentimientos_pago" ENABLE ROW LEVEL SECURITY;
