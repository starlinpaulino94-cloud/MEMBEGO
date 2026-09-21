-- ============================================================================
-- ROTAR EL SECRETO DE UN WEBHOOK SIN CORTAR  ·  auditoría, hallazgo A-7
-- ============================================================================
--
-- `suscripciones_webhook` tenía UN secreto. Cambiarlo dejaba de golpe todas las
-- entregas sin una firma que el receptor pudiera reconocer, hasta que alguien
-- copiara el nuevo a mano en su servidor — así que la única rotación posible en
-- la práctica era borrar la suscripción y crear otra, que además cambia el id y
-- tira el historial de entregas.
--
-- Una rotación que obliga a un corte de servicio es una rotación que no se
-- hace. Y la primera vez que hace falta rotar de verdad es cuando se sospecha
-- que el secreto se filtró, o sea el peor momento para descubrir que el
-- procedimiento duele.
--
-- Con estas dos columnas se firma con el viejo Y el nuevo durante unos días
-- (la cabecera v2 lleva las dos firmas y el receptor acepta con la que tenga),
-- y el solape se acaba SOLO: quien firma compara contra el reloj, así que una
-- fila caducada deja de firmar con el viejo aunque nadie la limpie.
--
-- ---------------------------------------------------------------------------
-- NULL = NO HAY ROTACIÓN EN CURSO
--
-- Que es el estado de todas las filas que existen. No hace falta rellenar nada
-- y no hay ventana en la que ninguna suscripción cambie de comportamiento por
-- haber aplicado esto: sin rotación, se firma con `secreto` como siempre.
--
-- Solo AÑADE: dos columnas nullable. Idempotente.
-- ============================================================================

-- AlterTable
ALTER TABLE "suscripciones_webhook" ADD COLUMN IF NOT EXISTS "secretoAnterior" TEXT;

-- AlterTable
ALTER TABLE "suscripciones_webhook" ADD COLUMN IF NOT EXISTS "secretoAnteriorHasta" TIMESTAMP(3);
