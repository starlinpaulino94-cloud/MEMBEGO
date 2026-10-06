-- MEMBEGO SUPPLY 2.0 · SLICE 9 · BLOQUE 4
--
-- Dos tablas nuevas y pequeñas. Aditivas: no se toca ninguna columna
-- existente ni ninguna migración anterior.
--
-- Por qué no caben en lo que ya hay: `Notificacion` es un buzón por persona
-- sin máquina de estados; `supply_v2_finance_incidents` es dinero que no cuadra
-- —un outbox atrasado no lo es—; y `audit_logs` es append-only, registra que
-- algo pasó y no el estado de algo que sigue pasando. El razonamiento largo
-- está en el esquema.

-- ── Interruptores operativos ───────────────────────────────────────────────
--
-- No pueden vivir solo en el entorno: cambiar una variable pide un despliegue,
-- y un interruptor de emergencia que tarda un despliegue no lo es. Una fila
-- existe solo si alguien tocó el interruptor; ausencia = el valor por defecto
-- del código.
CREATE TABLE IF NOT EXISTS "supply_v2_operational_switches" (
    "key"         TEXT NOT NULL,
    "enabled"     BOOLEAN NOT NULL,
    "reason"      TEXT,
    "changedById" TEXT,
    "changedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "supply_v2_operational_switches_pkey" PRIMARY KEY ("key")
);

ALTER TABLE "supply_v2_operational_switches"
  ADD CONSTRAINT "supply_v2_operational_switches_changedById_fkey"
  FOREIGN KEY ("changedById") REFERENCES "users"("id") ON UPDATE CASCADE ON DELETE SET NULL;

-- Apagar algo exige decir por qué. Encender no: lo que necesita explicación es
-- la decisión de dejar de procesar, no la de volver a la normalidad.
ALTER TABLE "supply_v2_operational_switches"
  DROP CONSTRAINT IF EXISTS "supply_v2_operational_switches_reason";
ALTER TABLE "supply_v2_operational_switches"
  ADD CONSTRAINT "supply_v2_operational_switches_reason"
  CHECK ("enabled" = true OR ("reason" IS NOT NULL AND length(btrim("reason")) >= 3));

-- ── Alertas operativas, UNA POR CONDICIÓN ──────────────────────────────────
--
-- La clave primaria ES la condición: eso es lo que hace, por construcción, que
-- la misma condición evaluada dos veces sea una sola alerta y no dos. Si cada
-- fila que la provoca abriera la suya, veintitrés efectos fallidos serían
-- veintitrés avisos y nadie leería el veinticuatro.
CREATE TABLE IF NOT EXISTS "supply_v2_operational_alerts" (
    "key"              TEXT NOT NULL,
    "status"           TEXT NOT NULL DEFAULT 'ACTIVE',
    "severity"         TEXT NOT NULL DEFAULT 'WARNING',
    "count"            INTEGER NOT NULL DEFAULT 0,
    "detail"           JSONB,
    "summary"          TEXT NOT NULL,
    "firstSeenAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt"       TIMESTAMP(3),
    "acknowledgedById" TEXT,
    "acknowledgedAt"   TIMESTAMP(3),
    "acknowledgedNote" TEXT,
    CONSTRAINT "supply_v2_operational_alerts_pkey" PRIMARY KEY ("key")
);

CREATE INDEX IF NOT EXISTS "supply_v2_operational_alerts_status_severity_lastSeenAt_idx"
  ON "supply_v2_operational_alerts" ("status", "severity", "lastSeenAt");

ALTER TABLE "supply_v2_operational_alerts"
  ADD CONSTRAINT "supply_v2_operational_alerts_acknowledgedById_fkey"
  FOREIGN KEY ("acknowledgedById") REFERENCES "users"("id") ON UPDATE CASCADE ON DELETE SET NULL;

-- Forma: los estados y severidades que el dominio sabe dar, la cuenta nunca
-- negativa, una resuelta tiene fecha de cierre, y «visto» sin nombre ni
-- explicación no es un reconocimiento.
ALTER TABLE "supply_v2_operational_alerts"
  DROP CONSTRAINT IF EXISTS "supply_v2_operational_alerts_shape";
ALTER TABLE "supply_v2_operational_alerts"
  ADD CONSTRAINT "supply_v2_operational_alerts_shape" CHECK (
    "status" IN ('ACTIVE', 'ACKNOWLEDGED', 'RESOLVED')
    AND "severity" IN ('INFO', 'WARNING', 'CRITICAL')
    AND "count" >= 0
    AND ("status" = 'RESOLVED') = ("resolvedAt" IS NOT NULL)
    AND ("status" <> 'ACKNOWLEDGED'
         OR ("acknowledgedById" IS NOT NULL AND "acknowledgedAt" IS NOT NULL
             AND "acknowledgedNote" IS NOT NULL AND length(btrim("acknowledgedNote")) >= 3)));
