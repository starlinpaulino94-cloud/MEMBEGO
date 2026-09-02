-- ============================================================================
-- EXCURSIONES · Las 19 columnas de configuración que el esquema declara
-- ============================================================================
-- QUÉ PASÓ
--
-- La PR #434 («config completa, reducción de pasajeros y reembolsos») añadió
-- 19 campos al modelo `ExcursionesConfig` y NO escribió el SQL. El control
-- «Esquema de base de datos» del CI lo detectó y salió en ROJO; la PR se
-- mezcló igualmente.
--
-- Es el mismo fallo que documenta `20260901b_columnas_sin_migracion` (PR
-- #416), y tiene la misma consecuencia: el código desplegado pide columnas que
-- no existen. Prisma no falla al arrancar — falla en la primera consulta que
-- las toca, que aquí es CUALQUIER lectura de la configuración de Excursiones.
--
-- TODOS LOS CAMPOS LLEVAN DEFAULT, y los defaults son EXACTAMENTE los del
-- esquema. Si difirieran, una empresa vería una política en pantalla y el
-- servidor aplicaría otra.
--
-- 100% ADITIVA. Columnas nuevas con default y NOT NULL: PostgreSQL 11+ las
-- añade sin reescribir la tabla (guarda el default en el catálogo). Sin
-- UPDATE, sin backfill, sin borrar nada. Idempotente.
-- ============================================================================

-- ── Políticas de reserva y reembolso ────────────────────────────────────────

ALTER TABLE "excursiones_config"
  ADD COLUMN IF NOT EXISTS "permitirReduccionPasajeros"   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "anticipacionMinimaHoras"      INTEGER NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS "permitirCancelacion"          BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "anticipacionCancelacionHoras" INTEGER NOT NULL DEFAULT 48,
  ADD COLUMN IF NOT EXISTS "penalizacionCancelacionPct"   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "tipoReembolso"                TEXT    NOT NULL DEFAULT 'COMPLETO',
  ADD COLUMN IF NOT EXISTS "horasLimiteReembolso"         INTEGER NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS "notasPoliticas"               TEXT;

-- ── Check-in ────────────────────────────────────────────────────────────────

ALTER TABLE "excursiones_config"
  ADD COLUMN IF NOT EXISTS "diasGraciaCheckin"      INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "permitirCheckinSinPago" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "prefijoCheckin"         TEXT    NOT NULL DEFAULT 'EXC:';

-- ── Reserva ─────────────────────────────────────────────────────────────────

ALTER TABLE "excursiones_config"
  ADD COLUMN IF NOT EXISTS "anticipacionMinimaReservaHoras" INTEGER NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS "anticipacionMaximaReservaDias"  INTEGER NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS "maxPasajerosPorReserva"         INTEGER NOT NULL DEFAULT 50;

-- ── Notificaciones ──────────────────────────────────────────────────────────

ALTER TABLE "excursiones_config"
  ADD COLUMN IF NOT EXISTS "enviarConfirmacionReserva" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "enviarRecordatorioHoras"   INTEGER NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS "emailNotificaciones"       TEXT;

-- ── Pago ────────────────────────────────────────────────────────────────────
-- Los dos defaults se copian LITERALES del esquema. `metodosPagoHabilitados`
-- es un array JSON, no un array de Postgres: Prisma lo declara como `Json`.

ALTER TABLE "excursiones_config"
  ADD COLUMN IF NOT EXISTS "metodosPagoHabilitados" JSONB NOT NULL
    DEFAULT '["EFECTIVO","TARJETA","TRANSFERENCIA","DEPOSITO","LINK"]'::jsonb,
  ADD COLUMN IF NOT EXISTS "tasasCambio" JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ── Verificación ────────────────────────────────────────────────────────────

SELECT 'excursiones_config_politicas' AS objeto,
       count(*) AS columnas_nuevas,
       CASE WHEN count(*) = 19 THEN 'OK' ELSE 'FALTA' END AS estado
  FROM information_schema.columns
 WHERE table_name = 'excursiones_config'
   AND column_name IN (
     'permitirReduccionPasajeros','anticipacionMinimaHoras','permitirCancelacion',
     'anticipacionCancelacionHoras','penalizacionCancelacionPct','tipoReembolso',
     'horasLimiteReembolso','notasPoliticas','diasGraciaCheckin',
     'permitirCheckinSinPago','prefijoCheckin','anticipacionMinimaReservaHoras',
     'anticipacionMaximaReservaDias','maxPasajerosPorReserva',
     'enviarConfirmacionReserva','enviarRecordatorioHoras','emailNotificaciones',
     'metodosPagoHabilitados','tasasCambio'
   );

-- ── Diagnóstico ─────────────────────────────────────────────────────────────
-- Cuántas empresas tienen ya fila de configuración. Todas heredan los defaults.
SELECT 'empresas_con_config' AS objeto, count(*) AS cuantas FROM excursiones_config;
