-- Módulo de PERMISOS por empleado (14-08-2026): ajustes sobre el rol —
-- conceder o negar secciones del panel, y negar funciones concretas dentro
-- de una sección. Solo se guardan diferencias; null = hereda el rol.
-- Idempotente.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "permisos" JSONB;
