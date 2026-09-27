--- Membego Supply · los tres avisos analíticos (cierra la Fase 40 del todo).
--- Aditiva: tres valores nuevos en un enum. Nada que revertir.
---
--- ANTES QUE SU CÓDIGO, como las anteriores: el cron los escribe y PostgreSQL
--- rechazaría un valor desconocido. El envío es fail-open y va fuera de los
--- trabajos que mueven el ledger, así que mientras falte esta migración el cron
--- sigue soltando holds y cerrando lo vencido — solo no suena la campanita.

ALTER TYPE "NotifTipo" ADD VALUE IF NOT EXISTS 'SUPPLY_PROVEEDOR_EN_RIESGO';
ALTER TYPE "NotifTipo" ADD VALUE IF NOT EXISTS 'SUPPLY_NO_CABE';
ALTER TYPE "NotifTipo" ADD VALUE IF NOT EXISTS 'SUPPLY_CAPITAL_DORMIDO';
