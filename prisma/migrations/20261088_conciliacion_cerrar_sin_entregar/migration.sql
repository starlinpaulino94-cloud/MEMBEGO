-- CONCILIACIÓN · «Cerrar sin entregar» (acción de la bitácora).
--
-- Hasta ahora un cobro aprobado cuya entrega no se cerró solo tenía dos salidas: reintentar la entrega
-- o marcarla como entregada. Cuando la causa es otra —el dinero se devolvió en CardNET, fue un cobro de
-- prueba, la membresía se borró con la cuenta del cliente— el aviso se quedaba para siempre. La nueva
-- acción cierra el cobro SIN entregar (`pago_intentos.fulfillmentEstado = 'DESCARTADA'`, columna TEXT:
-- no necesita cambio) y exige su asiento en la bitácora, en la misma transacción.
--
-- Al FINAL del enum (ADD VALUE sin BEFORE) para que el diff de Prisma no vea deriva, y sola en su
-- migración: PostgreSQL no deja USAR un valor de enum en la transacción que lo crea.
--
-- Orden de despliegue: esta migración ANTES que el código. Si el código llegara antes, «Cerrar sin
-- entregar» fallaría sin cerrar nada (el cambio de estado y la bitácora van juntos).

ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'CONCILIACION_ENTREGA_CERRADA_SIN_ENTREGAR';
