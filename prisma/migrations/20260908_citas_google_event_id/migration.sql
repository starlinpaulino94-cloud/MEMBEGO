-- ============================================================================
-- MEMBEGO CONNECT · Google Calendar — la cita recuerda su evento
-- ============================================================================
-- QUÉ ARREGLA
--
-- Al confirmar una cita se creaba el evento en la agenda de Google del negocio
-- y el id que devolvía Google SE DESCARTABA. Sin él, cancelar la cita dejaba
-- el evento huérfano en la agenda —el equipo veía una cita que ya no existía—
-- y un reintento podía crearlo dos veces.
--
-- Esta columna guarda ese id. Con él, al cancelar se borra el evento
-- (`events.delete`) y al confirmar no se crea si ya está.
--
-- 100% ADITIVA. Una columna anulable y sin default: en PostgreSQL 11+ es un
-- cambio de METADATOS —no reescribe la tabla, no toca una fila en disco—.
-- Sin UPDATE, sin backfill, sin borrar nada. Idempotente.
-- ============================================================================

ALTER TABLE "citas" ADD COLUMN IF NOT EXISTS "googleEventId" TEXT;
