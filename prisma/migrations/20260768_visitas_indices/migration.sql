-- Índices compuestos para `visits` (auditoría de producción · A-05).
--
-- `visits` es la tabla de mayor crecimiento del sistema: una fila por escaneo,
-- del orden de millones al mes con el volumen previsto. No tiene `companyId`
-- —se llega por la membresía—, así que todo reporte de empresa por rango de
-- fechas entra por `membershipId` y filtra por `fechaVisita`, y el historial
-- del cliente hace lo mismo por `clienteId`.
--
-- Con los índices sueltos que ya existían, PostgreSQL elige uno y descarta el
-- resto de filas leyéndolas; con el compuesto resuelve las dos condiciones en
-- una sola pasada del índice.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ AQUÍ NO DICE `CONCURRENTLY`
--
-- Lo decía, y hacía que el historial de migraciones no se pudiera reproducir:
-- `CREATE INDEX CONCURRENTLY` no puede ejecutarse dentro de una transacción, y
-- Prisma envuelve cada migración en una. `prisma migrate diff --from-migrations`
-- fallaba justo aquí, así que el CI no podía comprobar si el esquema tenía
-- cambios sin migración.
--
-- La versión con `CONCURRENTLY` sigue existiendo, en
-- `prisma/migrations_manual/2026-07-visitas-indices-concurrently.sql`, y es la
-- que hay que ejecutar EN PRODUCCIÓN **antes** que esta migración: crear el
-- índice sin `CONCURRENTLY` sobre millones de filas bloquea las escrituras de
-- `visits` durante minutos, y eso es el escáner de la pista sin registrar nada.
--
-- Sobre una base vacía —CI, entorno nuevo, base de pruebas— es instantáneo.
-- Y si los índices ya están (porque se corrió el archivo manual), el
-- `IF NOT EXISTS` hace que esto no haga nada.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS "visits_membershipId_fechaVisita_idx"
  ON "visits" ("membershipId", "fechaVisita");

CREATE INDEX IF NOT EXISTS "visits_clienteId_fechaVisita_idx"
  ON "visits" ("clienteId", "fechaVisita");
