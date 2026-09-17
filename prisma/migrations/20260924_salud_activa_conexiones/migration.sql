-- ============================================================================
-- SALUD ACTIVA DE LAS CONEXIONES  ·  auditoría de integraciones, hallazgo B-3
-- ============================================================================
--
-- Hasta aquí, el estado de una conexión solo cambiaba cuando un envío FALLABA
-- —salud pasiva—: una empresa se enteraba de que su acceso a Meta había
-- caducado cuando un mensaje no salía. `meta/salud.ts` existía y ningún cron lo
-- llamaba.
--
-- Esta columna es lo que hace que el aviso llegue ANTES. Un chequeo diario mira
-- la caducidad —que ya se guarda, sin abrir el sello— de las credenciales SIN
-- refresco de servidor (Facebook Login, una API key con fecha), y marca aquí las
-- que se acercan a su fin. La UI las enseña como «vuelve a conectar tu cuenta»
-- mientras todavía funcionan, no cuando ya se rompieron.
--
-- Por qué una columna nueva y no reutilizar `ultimoErrorAt`: aquél es un fallo
-- TRANSITORIO que se enfría en 24 h; esto es una condición PERSISTENTE que solo
-- reconectar arregla. Confundirlas haría que el aviso desapareciera solo,
-- dejando a la empresa a ciegas justo antes de la caducidad.
--
-- Solo AÑADE una columna, nullable. Idempotente, sin backfill.
-- ============================================================================

-- AlterTable
ALTER TABLE "conexiones_empresa"
    ADD COLUMN IF NOT EXISTS "reautorizarAt" TIMESTAMP(3);
