-- ============================================================================
-- MEMBRESÍAS · fecha de pago propia
-- ============================================================================
-- Ver docs/auditoria-clientes-membresias.md · hallazgo A-6.
--
-- Los reportes fechaban el cobro por `updatedAt` porque no había nada mejor, y
-- el propio código lo anotaba: «significa que editar una membresía vieja la
-- mueve de periodo». Cambiarle el plan a un cliente en agosto trasladaba su
-- cobro de marzo al informe de agosto. Un informe cerrado no debería poder
-- cambiar meses después.
--
-- La columna se escribe UNA vez, al confirmar el pago. Las membresías ya
-- cobradas se rellenan con su `updatedAt` —es la mejor aproximación que existe
-- para ellas, y es exactamente lo que los reportes venían usando, así que
-- ningún número cambia el día del despliegue—. A partir de aquí, cada cobro
-- nuevo guarda su fecha de verdad y deja de moverse.
--
-- 100% ADITIVA e idempotente.
-- ============================================================================

ALTER TABLE "memberships" ADD COLUMN IF NOT EXISTS "fechaPago" TIMESTAMP(3);

-- Relleno histórico: solo lo ya cobrado, y solo si está vacío (idempotente).
UPDATE "memberships"
   SET "fechaPago" = "updatedAt"
 WHERE "pagoConfirmado" = TRUE
   AND "fechaPago" IS NULL;

-- Los reportes suman lo cobrado de un periodo por empresa.
CREATE INDEX IF NOT EXISTS "memberships_companyId_fechaPago_idx"
    ON "memberships" ("companyId", "fechaPago");
