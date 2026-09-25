--- Membego Supply · «producto listo» (última pieza de la Fase 40).
---
--- El comercio marca que ya lo preparó y el cliente recibe el aviso. Dos
--- cambios, y el segundo es el que de verdad importa.

-- ── 1. El aviso ─────────────────────────────────────────────────────────────
ALTER TYPE "NotifTipo" ADD VALUE IF NOT EXISTS 'SUPPLY_PRODUCTO_LISTO';

-- ── 2. El índice que impide dos recogidas vivas del mismo beneficio ─────────
--
-- POR QUÉ ESTO NO ES UN DETALLE
--
-- El índice decía `WHERE estado = 'CONFIRMADA'`. Con el estado LISTA recién
-- estrenado, una reserva PREPARADA dejaba de contar como viva: el cliente podía
-- apartar una SEGUNDA recogida del mismo beneficio mientras la primera estaba
-- hecha y encima del mostrador. El comercio prepararía dos pizzas por un
-- derecho que solo paga una.
---
-- Un `if` en el código no basta: dos peticiones a la vez lo pasan las dos. La
-- unicidad tiene que vivir aquí.
--
-- Se recrea en vez de alterarse porque PostgreSQL no permite cambiar el WHERE
-- de un índice parcial. El hueco entre DROP y CREATE no existe: el editor de
-- Supabase y `migrate deploy` corren esto dentro de UNA transacción.
DROP INDEX IF EXISTS "supply_reservas_derecho_viva";
CREATE UNIQUE INDEX IF NOT EXISTS "supply_reservas_derecho_viva"
  ON "supply_reservas" ("derechoId") WHERE "estado" IN ('CONFIRMADA', 'LISTA');
