-- Onboarding v2 · Fase 7: la placa se vuelve identidad única del vehículo.
--
-- UNIQUE (pais, placaNormalizada) — cierra de verdad la condición de carrera
-- de los chequeos previos de duplicado (§18): dos registros simultáneos de la
-- misma placa ya no pueden colarse.
--
-- POR QUÉ ES SEGURO SOBRE LOS DATOS EXISTENTES (regla de compatibilidad):
-- las filas históricas tienen placaNormalizada NULL (la columna nació en la
-- migración 20260781 y solo los flujos nuevos la llenan), y en PostgreSQL los
-- NULL no chocan entre sí en un unique (NULLS DISTINCT, el default). El
-- constraint solo alcanza a las capturas nuevas y al backfill.
--
-- El BACKFILL de placas históricas es un paso aparte y deliberadamente manual:
-- scripts/backfill-placas.mjs (dry-run por defecto) normaliza las placas
-- viejas SALTANDO y reportando las que chocarían — nunca revienta contra este
-- constraint. Correrlo después de revisar `npm run auditar:placas`.
--
-- Idempotente: se puede correr varias veces sin efecto.

DROP INDEX IF EXISTS "vehiculos_pais_placaNormalizada_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "vehiculos_pais_placaNormalizada_key" ON "vehiculos"("pais", "placaNormalizada");

-- Centinela: confirma que el unique quedó puesto.
SELECT 'placa_identidad_unica' AS objeto,
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_indexes
         WHERE tablename = 'vehiculos' AND indexname = 'vehiculos_pais_placaNormalizada_key'
       ) THEN 'OK' ELSE 'FALTA' END AS estado;
