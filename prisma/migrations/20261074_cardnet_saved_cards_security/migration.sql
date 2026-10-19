-- Tarjetas guardadas: separación de billetera, cifrado del token y estados
-- explícitos para predeterminación y eliminación remota pendiente.
ALTER TABLE "tarjetas_tokenizadas"
  ADD COLUMN IF NOT EXISTS "proveedorCuenta" TEXT NOT NULL DEFAULT 'CARDNET',
  ADD COLUMN IF NOT EXISTS "tokenCifrado" TEXT,
  ADD COLUMN IF NOT EXISTS "predeterminada" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "eliminacionPendiente" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "consentimientoGuardadoAt" TIMESTAMP(3);

-- Conserva las filas históricas, pero evita dos tarjetas activas para el mismo
-- perfil de la misma cuenta CardNET. Si una versión previa creó duplicados,
-- mantiene activa la más antigua y conserva las demás como inactivas.
WITH duplicadas AS (
  SELECT "id", ROW_NUMBER() OVER (
    PARTITION BY "companyId", "proveedorCuenta", "customerId", "paymentProfileId"
    ORDER BY "createdAt", "id"
  ) AS numero
  FROM "tarjetas_tokenizadas"
  WHERE "paymentProfileId" IS NOT NULL AND "activa" = TRUE
)
UPDATE "tarjetas_tokenizadas" t
SET "activa" = FALSE, "predeterminada" = FALSE
FROM duplicadas d
WHERE d."id" = t."id" AND d.numero > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "tarjetas_tokenizadas_perfil_activo_key"
  ON "tarjetas_tokenizadas"("companyId", "proveedorCuenta", "customerId", "paymentProfileId")
  WHERE "paymentProfileId" IS NOT NULL AND "activa" = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS "tarjetas_tokenizadas_predeterminada_cliente_key"
  ON "tarjetas_tokenizadas"("companyId", "clienteId")
  WHERE "predeterminada" = TRUE AND "activa" = TRUE;

CREATE INDEX IF NOT EXISTS "tarjetas_tokenizadas_eliminacion_pendiente_idx"
  ON "tarjetas_tokenizadas"("eliminacionPendiente", "activa");

-- El permiso para guardar una tarjeta se separa de la autorización anterior
-- de renovación. Los registros viejos no se reinterpretan como nuevos consentimientos.
ALTER TABLE "cardnet_capture_sessions"
  ADD COLUMN IF NOT EXISTS "guardarTarjeta" BOOLEAN NOT NULL DEFAULT FALSE;

-- Si no existía una tarjeta predeterminada, elige de forma determinista la
-- tarjeta activa más antigua de cada cliente en cada empresa.
WITH primera AS (
  SELECT "id", ROW_NUMBER() OVER (
    PARTITION BY "companyId", "clienteId" ORDER BY "createdAt", "id"
  ) AS numero
  FROM "tarjetas_tokenizadas"
  WHERE "activa" = TRUE
)
UPDATE "tarjetas_tokenizadas" t
SET "predeterminada" = TRUE
FROM primera p
WHERE p."id" = t."id" AND p.numero = 1
  AND NOT EXISTS (
    SELECT 1 FROM "tarjetas_tokenizadas" existente
    WHERE existente."companyId" = t."companyId"
      AND existente."clienteId" = t."clienteId"
      AND existente."activa" = TRUE
      AND existente."predeterminada" = TRUE
  );
