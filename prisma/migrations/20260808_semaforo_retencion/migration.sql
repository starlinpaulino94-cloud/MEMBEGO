-- ============================================================================
-- SEMÁFORO DEL CLIENTE · umbrales por empresa
-- ============================================================================
-- Ver docs/auditoria-clientes-membresias.md · bloque 3.
--
-- Cuántos días sin venir ponen a un cliente en riesgo, cuántos lo dan por
-- dormido y cuántos por perdido. Se configuran por empresa porque la frecuencia
-- normal de visita no es la misma en todos los oficios: treinta días sin lavar
-- el carro es raro; treinta días sin cenar fuera, no.
--
-- Mismo patrón que `engagementConfig`, `regalosConfig` y `seguimientoConfig`:
-- una columna JSON opcional. NULL = los valores por defecto del código, así que
-- ninguna empresa cambia de comportamiento el día del despliegue.
--
-- 100% ADITIVA e idempotente.
-- ============================================================================

ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "retencionConfig" JSONB;
