-- ============================================================================
-- MEMBEGO CONNECT · Fase 9 — Concesiones del superadmin
-- ============================================================================
-- Conceder claves de API a una empresa le abre sus datos a terceros: es una
-- decisión comercial con consecuencias de seguridad, y no puede quedar sin
-- nombre y sin fecha.
--
-- 100% ADITIVA. Idempotente.
-- ============================================================================

ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'CONNECT_CONCEDIDO';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'CONNECT_CONECTOR_ESTADO';

SELECT 'connect_marketplace' AS objeto, 'OK' AS estado;
