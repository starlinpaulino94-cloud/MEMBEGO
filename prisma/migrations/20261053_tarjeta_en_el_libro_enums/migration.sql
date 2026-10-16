-- LIBRO DE VENTAS · método «tarjeta» (pago con tarjeta → comprobante, fase 1).
--
-- Va en su propia migración porque PostgreSQL no permite USAR un valor de enum nuevo en la
-- misma transacción que lo crea; la migración siguiente (20261054) lo usa en un CHECK.
--
-- Hasta hoy el libro (`transactions.metodoCobro`) solo conocía EFECTIVO, TRANSFERENCIA y OTRO:
-- un cobro con tarjeta —el de la pasarela y el del mostrador— no se podía expresar y, cuando
-- se registraba, salía como «Otro». Se añade AL FINAL del enum (ADD VALUE sin BEFORE) para
-- que el diff de Prisma no vea deriva.

ALTER TYPE "MetodoCobroTipo" ADD VALUE IF NOT EXISTS 'TARJETA';
