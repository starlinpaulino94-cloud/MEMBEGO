-- ============================================================================
-- MÉTRICAS DE USO POR CREDENCIAL  ·  auditoría de integraciones, hallazgo B-7
-- ============================================================================
--
-- De cada credencial se sabía una sola cosa —`lastUsedAt`, cuándo se usó por
-- última vez—. No había peticiones por día, por endpoint ni tasa de error, ni
-- para el integrador ni para el superadmin. Esta tabla lo mide.
--
-- ---------------------------------------------------------------------------
-- AGREGADO POR DÍA, NO UNA FILA POR PETICIÓN
--
-- Una fila por llamada crecería sin techo. Aquí una fila es
-- (día, credencial, endpoint, método, resultado) con un CONTADOR: la escritura
-- es un upsert que incrementa, y la lectura no agrupa nada caro. El único índice
-- único —el de la clave del upsert— es lo que hace atómico el incremento.
--
-- ---------------------------------------------------------------------------
-- NI SECRETOS NI IDS DE CLIENTE
--
-- `endpoint` es la ruta normalizada (`/customers/{id}`), nunca una con un id
-- dentro: la cardinalidad queda acotada y ningún id de cliente entra en la
-- telemetría. Sin claves foráneas, como `registros_conector`: el uso tiene que
-- sobrevivir a la credencial que lo generó.
--
-- Solo CREA una tabla. Idempotente.
-- ============================================================================

-- CreateTable
CREATE TABLE IF NOT EXISTS "metricas_uso_credencial" (
    "id" TEXT NOT NULL,
    "dia" DATE NOT NULL,
    "origen" TEXT NOT NULL,
    "credencialId" TEXT NOT NULL,
    "companyId" TEXT,
    "endpoint" TEXT NOT NULL,
    "metodo" TEXT NOT NULL,
    "resultado" TEXT NOT NULL,
    "peticiones" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "metricas_uso_credencial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex · la clave del upsert-incremento: una fila por combinación y día.
CREATE UNIQUE INDEX IF NOT EXISTS "metricas_uso_credencial_dia_origen_credencialId_endpoint_me_key"
    ON "metricas_uso_credencial"("dia", "origen", "credencialId", "endpoint", "metodo", "resultado");

-- CreateIndex · leer el uso de UNA credencial en una ventana de días.
CREATE INDEX IF NOT EXISTS "metricas_uso_credencial_credencialId_dia_idx"
    ON "metricas_uso_credencial"("credencialId", "dia");

-- CreateIndex · leer el uso de todas las claves de UNA empresa.
CREATE INDEX IF NOT EXISTS "metricas_uso_credencial_companyId_dia_idx"
    ON "metricas_uso_credencial"("companyId", "dia");

-- El origen solo puede ser uno de los dos. Un valor inventado dejaría filas que
-- ninguna lectura sabría a qué credencial atribuir.
DO $$ BEGIN
  ALTER TABLE "metricas_uso_credencial"
    ADD CONSTRAINT "metricas_uso_credencial_origen_valido" CHECK ("origen" IN ('CLAVE_API','SISTEMA'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
