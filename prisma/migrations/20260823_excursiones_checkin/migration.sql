-- Check-in de pasajeros: quién se subió de verdad al bus.
--
-- POR QUÉ UN TOKEN PROPIO Y NO EL QrToken DE MEMBRESÍAS
--
-- El QR de membresía es una credencial de canje con su ciclo de vida (activo,
-- consumido, revocado) y sus reglas de seguridad. El check-in no canjea nada:
-- solo dice «este grupo se presentó». Meterlo en QrToken habría obligado a
-- tocar el flujo del escáner del mostrador para un caso que no es un canje —
-- justo lo que no se hace. Este token vive en la reserva, nace con ella y no
-- se reutiliza nunca en otra: por eso es único GLOBAL.
--
-- `presente` por pasajero, y no solo una marca en la reserva, porque reservar
-- cuatro y presentarse tres es lo normal: el manifiesto tiene que poder decir
-- cuál de los cuatro faltó, y esa diferencia es la que después explica un
-- reembolso parcial.
--
-- SEGURA: solo añade columnas opcionales (y una con default). No toca ninguna
-- fila existente: las reservas de antes quedan sin token —se les genera al
-- pedirlo— y con todos sus pasajeros como no presentes, que es la verdad.
ALTER TABLE "reservas_excursion" ADD COLUMN IF NOT EXISTS "checkinToken" TEXT;
ALTER TABLE "reservas_excursion" ADD COLUMN IF NOT EXISTS "checkinAt"    TIMESTAMP(3);
ALTER TABLE "reservas_excursion" ADD COLUMN IF NOT EXISTS "checkinPorId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "reservas_excursion_checkinToken_key"
  ON "reservas_excursion" ("checkinToken");

ALTER TABLE "reserva_pasajeros" ADD COLUMN IF NOT EXISTS "presente"  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "reserva_pasajeros" ADD COLUMN IF NOT EXISTS "checkinAt" TIMESTAMP(3);
