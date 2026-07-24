-- Plataforma modular · E1 (docs/ESTRATEGIA-PLATAFORMA.md): capacidades por
-- empresa. JSON { categoria?, overrides?: { CAPACIDAD: boolean } }.
-- NULL = paquete base de su categoría — nada de lo actual cambia.
-- Idempotente: se puede correr más de una vez sin efecto.

ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "capacidades" JSONB;
