-- MEMBEGO SUPPLY 2.0 · editar una oferta publicada
--
-- Hasta ahora una oferta solo se podía crear y transicionar: una errata en un
-- título obligaba a cancelarla y publicar otra, con código y enlace nuevos.
-- `editarOfertaEnTx` lo arregla y deja su propio rastro, y para eso la bitácora
-- necesita un valor más.
--
-- Va en una migración propia porque PostgreSQL no deja usar un valor de enum
-- recién añadido dentro de la misma transacción que lo crea.

ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_OFFER_UPDATED';
