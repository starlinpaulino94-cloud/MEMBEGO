-- MEMBEGO SUPPLY 2.0 · SLICE 9 · BLOQUE 2
--
-- Una sola columna nueva, y hace falta por una razón concreta:
--
-- El despachador reclama una fila poniéndola en PROCESSING y la entrega
-- después, FUERA de la transacción. Si el proceso muere entre una cosa y otra,
-- la fila queda reclamada para siempre: nadie la vuelve a mirar, porque el
-- worker solo busca PENDING y FAILED. Para poder recuperarla hay que saber
-- CUÁNDO se reclamó —sin eso, una fila reclamada por un proceso muerto es
-- indistinguible de una reclamada hace un segundo, y la recuperación o le roba
-- el trabajo a un worker vivo o no se atreve nunca a correr—.
--
-- `availableAt` no sirve para esto: dice cuándo se PUEDE intentar, no cuándo se
-- tomó. Reutilizarla obligaría a que el reclamo moviera el futuro de la fila,
-- que es justo lo que la escalera de reintentos decide.
--
-- Aditiva: columna que admite NULL, índice nuevo y un CHECK propio. No se toca
-- ninguna migración anterior ni el CHECK que ya existe.

ALTER TABLE "supply_v2_outbox_events"
  ADD COLUMN IF NOT EXISTS "claimedAt" TIMESTAMP(3);

-- Compatible con los datos que ya hay: lo que estuviera reclamado sin marca se
-- le pone la de ahora, de modo que la recuperación lo verá vencer, no lo dará
-- por vivo para siempre.
UPDATE "supply_v2_outbox_events"
   SET "claimedAt" = CURRENT_TIMESTAMP
 WHERE "status" = 'PROCESSING' AND "claimedAt" IS NULL;

-- Lo reclamado SIEMPRE tiene marca de reclamo. Sin esto, una fila sin marca en
-- PROCESSING sería invisible para la recuperación, que es exactamente el fallo
-- que la columna existe para cerrar.
ALTER TABLE "supply_v2_outbox_events"
  DROP CONSTRAINT IF EXISTS "supply_v2_outbox_events_lease";
ALTER TABLE "supply_v2_outbox_events"
  ADD CONSTRAINT "supply_v2_outbox_events_lease"
  CHECK ("status" <> 'PROCESSING' OR "claimedAt" IS NOT NULL);

-- Lo que pregunta la recuperación: reclamados hace más de X.
CREATE INDEX IF NOT EXISTS "supply_v2_outbox_events_status_claimedAt_idx"
  ON "supply_v2_outbox_events" ("status", "claimedAt");
