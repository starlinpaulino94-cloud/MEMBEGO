-- ============================================================================
-- BACKFILL: la historia que SÍ se puede reconstruir, y solo esa
-- ============================================================================
--
-- `docs/runbooks/restaurar-datos-borrados.md` ya escribió la regla, y la
-- escribió pensando exactamente en esto:
--
--   «No inventes filas para "cuadrar". Un hueco documentado es recuperable;
--    un dato inventado contamina los reportes para siempre.»
--
-- Así que aquí solo se reconstruye lo que dejó rastro en `audit_logs`. Todo lo
-- que salga de esta migración queda marcado con `reconstruido = true` y
-- `origen = 'RECONSTRUIDO'`, y `registradoEn` dirá HOY mientras `ocurridoEn`
-- dice cuándo pasó: esa distancia es la señal de que la fila es de segunda
-- mano.
--
-- QUÉ SE RECUPERA
--
--   MEMBRESIA_RENOVADA      → RENOVADA
--   MEMBRESIA_DESACTIVADA   → VENCIDA
--   MEMBRESIA_CANCELADA     → CANCELADA, PERO solo las de verdad (ver abajo)
--
-- QUÉ NO, Y POR QUÉ
--
-- 1. LOS VENCIMIENTOS AUTOMÁTICOS NO SE PUEDEN RECUPERAR FILA A FILA.
--    El job de vencimiento escribe UNA entrada por empresa con la lista de ids
--    dentro del payload —y truncada a 200—, no una por membresía. Se reconoce
--    por `payload->>'tipo' = 'VENCIMIENTO_AUTOMATICO'`, y se DESCARTA: sacar
--    membresías de un array truncado daría un recuento que parece completo y
--    no lo es. Desde esta migración en adelante, el job escribe un evento por
--    membresía y el problema no se repite.
--
--    De paso queda dicho: hasta hoy, en la bitácora, «vencida» y «cancelada»
--    compartían la misma `accion`. Cualquier conteo de cancelaciones hecho
--    sobre `audit_logs` sin mirar el payload estaba contaminado con
--    vencimientos.
--
-- 2. ACTIVACIONES Y CAMBIOS DE PLAN NO SE RECUPERAN.
--    Los dos se auditan como `PAGO_APROBADO`, mezclados con cobros que no son
--    ninguna de las dos cosas. Distinguirlos exigiría adivinar por la forma del
--    payload, y una activación inventada es peor que una activación ausente.
--
-- Consecuencia, que los reportes deben decir en pantalla: el historial de
-- ACTIVACIONES y CAMBIOS DE PLAN empieza el día que se aplique esta migración.
-- El de RENOVACIONES y CANCELACIONES llega más atrás.
--
-- IDEMPOTENTE. Cada inserción comprueba que no exista ya un evento
-- reconstruido para la misma membresía, tipo e instante. Correrla dos veces no
-- duplica nada.
-- ============================================================================

-- ── Renovaciones ────────────────────────────────────────────────────────────
INSERT INTO "membresia_eventos"
  (id, "companyId", "membershipId", "clienteId", tipo, origen,
   "estadoAnterior", "estadoNuevo", "planAnteriorId", "planNuevoId",
   "actorUserId", "ocurridoEn", "registradoEn", reconstruido, payload)
SELECT
  gen_random_uuid()::text,
  m."companyId", m.id, m."clienteId",
  'RENOVADA'::"MembresiaEventoTipo",
  'RECONSTRUIDO'::"MembresiaEventoOrigen",
  NULL, 'ACTIVA', m."planId", m."planId",
  a."userId", a."createdAt", now(), true,
  jsonb_build_object('auditLogId', a.id)
FROM "audit_logs" a
JOIN "memberships" m ON m.id = a."entidadId"
WHERE a.accion = 'MEMBRESIA_RENOVADA'
  AND a."entidadTipo" = 'Membership'
  AND NOT EXISTS (
    SELECT 1 FROM "membresia_eventos" e
    WHERE e."membershipId" = m.id
      AND e.tipo = 'RENOVADA'
      AND e."ocurridoEn" = a."createdAt"
  );

-- ── Desactivaciones a mano → VENCIDA ────────────────────────────────────────
INSERT INTO "membresia_eventos"
  (id, "companyId", "membershipId", "clienteId", tipo, origen,
   "estadoAnterior", "estadoNuevo", "planAnteriorId",
   "actorUserId", "ocurridoEn", "registradoEn", reconstruido, payload)
SELECT
  gen_random_uuid()::text,
  m."companyId", m.id, m."clienteId",
  'VENCIDA'::"MembresiaEventoTipo",
  'RECONSTRUIDO'::"MembresiaEventoOrigen",
  a.payload->>'antes', 'VENCIDA', m."planId",
  a."userId", a."createdAt", now(), true,
  jsonb_build_object('auditLogId', a.id, 'manual', true)
FROM "audit_logs" a
JOIN "memberships" m ON m.id = a."entidadId"
WHERE a.accion = 'MEMBRESIA_DESACTIVADA'
  AND a."entidadTipo" = 'Membership'
  AND NOT EXISTS (
    SELECT 1 FROM "membresia_eventos" e
    WHERE e."membershipId" = m.id
      AND e.tipo = 'VENCIDA'
      AND e."ocurridoEn" = a."createdAt"
  );

-- ── Cancelaciones de verdad ─────────────────────────────────────────────────
-- El filtro del `tipo` es lo que separa una cancelación de una tanda de
-- vencimientos automáticos que comparte `accion` con ella.
INSERT INTO "membresia_eventos"
  (id, "companyId", "membershipId", "clienteId", tipo, origen,
   "estadoAnterior", "estadoNuevo", "planAnteriorId",
   "actorUserId", "ocurridoEn", "registradoEn", reconstruido, payload)
SELECT
  gen_random_uuid()::text,
  m."companyId", m.id, m."clienteId",
  'CANCELADA'::"MembresiaEventoTipo",
  'RECONSTRUIDO'::"MembresiaEventoOrigen",
  a.payload->>'prevEstado', 'CANCELADA', m."planId",
  a."userId", a."createdAt", now(), true,
  jsonb_build_object(
    'auditLogId', a.id,
    'programada', COALESCE(a.payload->>'tipo', '') = 'cancelacion_programada_por_cliente'
  )
FROM "audit_logs" a
JOIN "memberships" m ON m.id = a."entidadId"
WHERE a.accion = 'MEMBRESIA_CANCELADA'
  AND a."entidadTipo" = 'Membership'
  AND COALESCE(a.payload->>'tipo', '') <> 'VENCIMIENTO_AUTOMATICO'
  AND NOT EXISTS (
    SELECT 1 FROM "membresia_eventos" e
    WHERE e."membershipId" = m.id
      AND e.tipo = 'CANCELADA'
      AND e."ocurridoEn" = a."createdAt"
  );
