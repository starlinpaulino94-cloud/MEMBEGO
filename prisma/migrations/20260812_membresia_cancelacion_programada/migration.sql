-- ============================================================================
-- MEMBRESÍAS · cancelación por el cliente con efecto a fin de período
-- ============================================================================
-- Decisión de producto (12-08-2026): el cliente puede cancelar su membresía
-- desde la app. No pierde nada hoy: sigue ACTIVA con sus usos hasta
-- `fechaVencimiento`, y lo que cambia es el futuro — no se renueva (la misma
-- acción apaga `autoRenovar`) y al vencer muere sola. La columna guarda CUÁNDO
-- lo pidió; null = sin cancelación programada.
--
-- 100% ADITIVA e idempotente.
-- ============================================================================

ALTER TABLE "memberships" ADD COLUMN IF NOT EXISTS "canceladaAlVencimiento" TIMESTAMP(3);
