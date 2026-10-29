-- ELIMINAR NOTIFICACIONES · borrado suave (2026-10-29).
--
-- La persona puede eliminar avisos de su bandeja, uno a uno o todos. La fila NO
-- se borra: `(userId, dedupeKey)` es lo que impide que un aviso por lote
-- (renovaciones, regalos, ofertas, automatizaciones) se vuelva a enviar al
-- repetirse el barrido. Solo se marca con la fecha en que se eliminó.

ALTER TABLE "notificaciones" ADD COLUMN "eliminadaEn" TIMESTAMP(3);
