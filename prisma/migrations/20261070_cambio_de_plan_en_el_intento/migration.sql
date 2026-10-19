-- CAMBIO DE PLAN PAGADO CON TARJETA · el intento recuerda QUÉ plan se pagó (pago con tarjeta → comprobante).
--
-- QUÉ CORRIGE. Un cliente con la membresía activa pide un plan mayor y paga la diferencia prorrateada con tarjeta.
-- La pasarela cobraba, pero no había entrega: `activarMembresia` rechaza una membresía ya activa y una persona tenía que
-- aplicar el cambio desde Pagos. Para entregarlo solo se necesita saber QUÉ plan se pagó. El importe prorrateado depende
-- del día, así que no se puede deducir después; y la membresía puede haber cambiado su pedido entre el cobro y la entrega.
--
--   · `pago_intentos.planDestinoId` — el plan pedido cuando se creó el intento. Nulo en todo lo que no es un cambio de plan
--     (y en los cambios de plan anteriores a esta columna, que siguen entregándose a mano).
--   · `cardnet_capture_sessions.planDestinoId` — la sesión de captura de la app lo lleva hasta el intento de compra.
--
-- ADITIVA: dos columnas nulas y dos claves foráneas con SET NULL (borrar un plan no borra cobros). Rollback: DROP de las
-- dos claves y de las dos columnas.

ALTER TABLE "pago_intentos" ADD COLUMN IF NOT EXISTS "planDestinoId" TEXT;
ALTER TABLE "cardnet_capture_sessions" ADD COLUMN IF NOT EXISTS "planDestinoId" TEXT;

DO $$ BEGIN
    ALTER TABLE "pago_intentos" ADD CONSTRAINT "pago_intentos_planDestinoId_fkey"
      FOREIGN KEY ("planDestinoId") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "cardnet_capture_sessions" ADD CONSTRAINT "cardnet_capture_sessions_planDestinoId_fkey"
      FOREIGN KEY ("planDestinoId") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
