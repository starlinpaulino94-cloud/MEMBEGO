-- LIBRO DE VENTAS · un cobro de pasarela deja UNA venta (pago con tarjeta → comprobante, fase 1).
--
-- QUÉ CORRIGE. Un pago con tarjeta aprobado en pasarela (app, web, renovación automática) activaba
-- la membresía y entregaba, pero no dejaba `Transaction`: sin ticket, sin factura, fuera del
-- historial de ventas, y la conciliación lo marcaba como «cobro sin transacción». La fase 2
-- escribe la venta en el punto único de activación; esta migración le da al libro lo que necesita:
--
--   1. `transactions.pagoIntentoId` — el intento de pago que originó la venta. ÚNICO: un webhook o
--      un reintento repetidos no pueden dejar dos ventas del mismo cobro.
--   2. CHECK `transactions_pago_intento_coherente` — solo una venta `SALE` con método TARJETA lleva
--      intento de pago.
--   3. Disparador `transactions_pago_intento_empresa` — el intento es de la MISMA empresa que la
--      venta y está APROBADO (un intento rechazado o ajeno nunca respalda una venta).
--   4. Backfill del cumplimiento (más abajo).
--
-- ADITIVA: una columna nula, un índice único, un CHECK sobre una columna que hoy es nula en todas
-- las filas y un disparador. Rollback: DROP del disparador, el CHECK, el índice y la columna.

ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "pagoIntentoId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "transactions_pagoIntentoId_key" ON "transactions"("pagoIntentoId");

DO $$ BEGIN
    ALTER TABLE "transactions" ADD CONSTRAINT "transactions_pagoIntentoId_fkey"
      FOREIGN KEY ("pagoIntentoId") REFERENCES "pago_intentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "transactions" ADD CONSTRAINT "transactions_pago_intento_coherente"
      CHECK ("pagoIntentoId" IS NULL OR ("tipo" = 'SALE' AND "metodoCobro" = 'TARJETA'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION transactions_pago_intento_empresa() RETURNS trigger AS $$
DECLARE
    v_empresa TEXT;
    v_estado  TEXT;
BEGIN
    IF NEW."pagoIntentoId" IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT "companyId", "estado" INTO v_empresa, v_estado
      FROM "pago_intentos" WHERE "id" = NEW."pagoIntentoId";
    IF v_empresa IS NULL THEN
        RAISE EXCEPTION 'transactions_pago_intento_empresa: el intento de pago % no existe o no es visible para esta empresa.', NEW."pagoIntentoId"
            USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF v_empresa <> NEW."companyId" THEN
        RAISE EXCEPTION 'transactions_pago_intento_empresa: el intento de pago % es de otra empresa.', NEW."pagoIntentoId"
            USING ERRCODE = 'check_violation';
    END IF;
    IF v_estado <> 'APROBADO' THEN
        RAISE EXCEPTION 'transactions_pago_intento_empresa: el intento de pago % está %, no APROBADO: no respalda una venta.', NEW."pagoIntentoId", v_estado
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "transactions_pago_intento_empresa" ON "transactions";
CREATE TRIGGER "transactions_pago_intento_empresa"
    BEFORE INSERT OR UPDATE OF "pagoIntentoId", "companyId" ON "transactions"
    FOR EACH ROW EXECUTE FUNCTION transactions_pago_intento_empresa();

-- ── Backfill del cumplimiento (el falso positivo de «Pagos cobrados con entrega pendiente») ──
--
-- `pago_intentos.fulfillmentEstado` se añadió (20260912_p1b) con DEFAULT 'PENDIENTE' y SIN rellenar
-- lo anterior: todo cobro aprobado antes de esa fecha cuenta, para siempre, como «cliente que pagó
-- y no recibió», aunque su membresía o su compra estén activas y entregadas.
--
-- SOLO se marca COMPLETADA lo DEMOSTRABLE: un intento APROBADO nunca tocado por el código de
-- cumplimiento (`fulfillmentEstado = 'PENDIENTE'`, sin `fulfillmentAt`, 0 intentos) cuya membresía
-- (o compra) quedó pagada y activada DENTRO DE LA HORA posterior al cobro. La entrega con tarjeta es
-- inmediata; lo que se activó después por otra vía (un administrador, otro pago) NO prueba que ESTE
-- cobro se entregó y se deja a la vista para revisarlo. Nunca se marca nada como FALLIDA.
-- `fulfillmentAt` toma la fecha real de la activación.
--
-- Idempotente: no toca lo ya marcado. Deja un NOTICE con las cuentas. (Los marcadores siguientes
-- los usa la prueba `pagos-tarjeta-modelo.db.test.ts` para ejecutar este mismo bloque.)

-- BACKFILL:INICIO
DO $$
DECLARE
    v_membresias INTEGER;
    v_compras    INTEGER;
    v_pendientes INTEGER;
BEGIN
    UPDATE "pago_intentos" p
       SET "fulfillmentEstado" = 'COMPLETADA',
           "fulfillmentAt"     = m."fechaPago"
      FROM "memberships" m
     WHERE p."membershipId" = m."id"
       AND p."estado" = 'APROBADO'
       AND p."fulfillmentEstado" = 'PENDIENTE'
       AND p."fulfillmentAt" IS NULL
       AND p."fulfillmentIntentos" = 0
       AND p."activadoAt" IS NOT NULL
       AND m."pagoConfirmado" = true
       AND m."estado" IN ('ACTIVA', 'VENCIDA', 'CANCELADA')
       AND m."fechaPago" >= p."activadoAt" - INTERVAL '1 minute'
       AND m."fechaPago" <= p."activadoAt" + INTERVAL '1 hour';
    GET DIAGNOSTICS v_membresias = ROW_COUNT;

    UPDATE "pago_intentos" p
       SET "fulfillmentEstado" = 'COMPLETADA',
           "fulfillmentAt"     = c."fechaActivacion"
      FROM "producto_compras" c
     WHERE p."compraId" = c."id"
       AND p."estado" = 'APROBADO'
       AND p."fulfillmentEstado" = 'PENDIENTE'
       AND p."fulfillmentAt" IS NULL
       AND p."fulfillmentIntentos" = 0
       AND p."activadoAt" IS NOT NULL
       AND c."pagoConfirmado" = true
       AND c."estado" IN ('ACTIVA', 'CONSUMIDA', 'EXPIRADA')
       AND c."fechaActivacion" >= p."activadoAt" - INTERVAL '1 minute'
       AND c."fechaActivacion" <= p."activadoAt" + INTERVAL '1 hour';
    GET DIAGNOSTICS v_compras = ROW_COUNT;

    SELECT COUNT(*) INTO v_pendientes
      FROM "pago_intentos"
     WHERE "estado" = 'APROBADO' AND "fulfillmentEstado" = 'PENDIENTE';

    RAISE NOTICE 'tarjeta_en_el_libro · cumplimiento: % cobros de membresía y % de compra marcados COMPLETADA (activación demostrada dentro de la hora del cobro); % cobros APROBADO siguen PENDIENTE y quedan para revisión humana.', v_membresias, v_compras, v_pendientes;
END $$;
-- BACKFILL:FIN
