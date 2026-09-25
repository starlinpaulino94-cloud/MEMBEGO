--- Membego Supply · Fase 40, segunda mitad: los avisos de EVENTO.
--- Aditiva y sin riesgo: ocho valores nuevos en un enum. Nada que revertir.
---
--- ANTES QUE SU CÓDIGO, como la anterior: estos valores los escriben las
--- funciones de dominio (entregar, reservar, redimir, abrirIncidencia,
--- confirmarPago). Si el código llega primero, PostgreSQL los rechaza — y por
--- eso el envío va fuera de la transacción y se traga su error: entregar una
--- pizza no puede fallar porque no suene la campanita.
---
--- `ADD VALUE` es legal en transacción desde PostgreSQL 12 mientras el valor no
--- se USE en la misma transacción. Aquí solo se declara.

ALTER TYPE "NotifTipo" ADD VALUE IF NOT EXISTS 'SUPPLY_BENEFICIO_NUEVO';
ALTER TYPE "NotifTipo" ADD VALUE IF NOT EXISTS 'SUPPLY_BENEFICIO_POR_VENCER';
ALTER TYPE "NotifTipo" ADD VALUE IF NOT EXISTS 'SUPPLY_RESERVA_CONFIRMADA';
ALTER TYPE "NotifTipo" ADD VALUE IF NOT EXISTS 'SUPPLY_ENTREGA_COMPLETADA';
ALTER TYPE "NotifTipo" ADD VALUE IF NOT EXISTS 'SUPPLY_VOUCHER_NUEVO';
ALTER TYPE "NotifTipo" ADD VALUE IF NOT EXISTS 'SUPPLY_CAPACIDAD_AL_LIMITE';
ALTER TYPE "NotifTipo" ADD VALUE IF NOT EXISTS 'SUPPLY_INCIDENCIA';
ALTER TYPE "NotifTipo" ADD VALUE IF NOT EXISTS 'SUPPLY_LIQUIDACION';
