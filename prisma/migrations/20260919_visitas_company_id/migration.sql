-- ============================================================================
-- `visits.companyId`  ·  Fase 5 del sistema de reportes
-- ============================================================================
--
-- POR QUÉ, SI LA COLUMNA SE HABÍA EVITADO A PROPÓSITO
--
-- El modelo decía —y para lo que entonces se consultaba era cierto— que a la
-- empresa de una visita se llega por la membresía. Lo que rompe esa decisión es
-- la pregunta del reporte de operación: «canjes de ESTA empresa entre ESTAS dos
-- fechas». Sin la columna hay que entrar por `membershipId` y descartar filas
-- después, sobre la tabla que más crece del sistema —una fila por escaneo, del
-- orden de millones al mes según prevé el propio modelo—.
--
-- QUÉ HACE ESTA MIGRACIÓN, Y QUÉ NO
--
-- Solo AÑADE: una columna nullable y dos índices. No toca ni una fila
-- existente, no rellena nada y no cambia ningún valor por defecto. Todo lo que
-- funciona hoy sigue funcionando sin un solo `companyId` escrito.
--
-- EL RELLENO VA APARTE, Y ES OBLIGATORIO
--
-- `prisma/migrations_manual/2026-09-visitas-company-id.sql` rellena las visitas
-- existentes POR LOTES y crea estos mismos índices con `CONCURRENTLY`. Ese
-- archivo se ejecuta A MANO Y ANTES, en producción. Aquí los índices se crean
-- con `IF NOT EXISTS` precisamente para que, cuando esta migración corra
-- después, no haga nada.
--
-- Si se ejecuta esta migración sin el relleno previo (entorno nuevo, CI, base
-- vacía) tampoco pasa nada: no hay filas que rellenar. Lo que NO puede pasar es
-- correrla en producción sin el manual, porque un `CREATE INDEX` normal bloquea
-- las escrituras de `visits` mientras construye —el escáner de la pista deja de
-- registrar durante minutos—. Es el mismo trato que ya se documentó en
-- `2026-07-visitas-indices-concurrently.sql`.
--
-- MIENTRAS QUEDEN FILAS EN NULL, EL REPORTE LO DICE. No se esconde: un reporte
-- que enseñara esas visitas como cero, sin avisar, estaría mintiendo sobre su
-- propio alcance.
-- ============================================================================

-- AlterTable
ALTER TABLE "visits" ADD COLUMN IF NOT EXISTS "companyId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "visits_companyId_fechaVisita_idx"
  ON "visits" ("companyId", "fechaVisita");

-- ── Bitácora ────────────────────────────────────────────────────────────────
-- El reporte de operación cuenta los QR generados y usados de una empresa entre
-- dos fechas. `audit_logs` tiene índices sueltos por `companyId`, por `accion` y
-- por `createdAt`: Postgres elige UNO y descarta el resto leyendo filas, que
-- sobre una bitácora con varias entradas por escaneo es la tabla entera.
CREATE INDEX IF NOT EXISTS "audit_logs_companyId_accion_createdAt_idx"
  ON "audit_logs" ("companyId", "accion", "createdAt");
