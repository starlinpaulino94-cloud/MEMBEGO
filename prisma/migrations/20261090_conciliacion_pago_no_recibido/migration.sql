-- CONCILIACIÓN · «Anular pago no recibido» (acción de la bitácora).
--
-- Una membresía con el pago confirmado a mano (transferencia aprobada, renovación en el mostrador) y sin
-- venta en el libro solo ofrecía «Abrir ficha», y la ficha no tiene cómo deshacer un pago: si el dinero
-- nunca entró, el caso se quedaba para siempre y el importe seguía sumando en los ingresos. La nueva
-- acción quita el pago de la membresía (`pagoConfirmado`, `montoPagado`, `fechaPago`: columnas que ya
-- existen) y exige su asiento en la bitácora, en la misma transacción.
--
-- Al FINAL del enum (ADD VALUE sin BEFORE) para que el diff de Prisma no vea deriva, y sola en su
-- migración: PostgreSQL no deja USAR un valor de enum en la transacción que lo crea.
--
-- Orden de despliegue: esta migración ANTES que el código. Si el código llegara antes, la acción fallaría
-- sin anular nada (el cambio y la bitácora van juntos).

ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'CONCILIACION_PAGO_ANULADO';
