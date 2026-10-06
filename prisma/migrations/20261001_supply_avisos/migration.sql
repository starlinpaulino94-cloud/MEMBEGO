--- Membego Supply · Fase 40: los avisos del cron llegan a la campanita.
--- Aditiva y sin riesgo: dos valores nuevos en un enum. Nada que revertir —un
--- valor de enum sin usar no molesta, y quitarlo exigiría recrear el tipo.
---
--- ESTA MIGRACIÓN VA ANTES QUE SU CÓDIGO. `notificar.ts` escribe estos dos
--- valores; si el código llega primero, PostgreSQL los rechaza. El envío es
--- fail-open y vive fuera de los trabajos que mueven el ledger, así que
--- mientras falte esta migración el cron sigue soltando holds y cerrando lo
--- vencido — solo no suena la campanita.
---
--- `ADD VALUE` es legal dentro de una transacción desde PostgreSQL 12 mientras
--- el valor no se USE en esa misma transacción. Aquí solo se declara.

ALTER TYPE "NotifTipo" ADD VALUE IF NOT EXISTS 'SUPPLY_POR_VENCER';
ALTER TYPE "NotifTipo" ADD VALUE IF NOT EXISTS 'SUPPLY_DESCUADRE';
