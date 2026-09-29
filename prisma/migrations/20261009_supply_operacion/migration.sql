-- ============================================================================
-- MEMBEGO SUPPLY · OPERACIÓN DESDE LA INTERFAZ   docs/membego-supply-auditoria-2026-09.md §7
-- ============================================================================
--
-- Segundo encargo (29-09-2026): que Supply se OPERE, no solo se mire. Esta
-- migración añade lo que las pantallas nuevas necesitan guardar:
--
--   · supply_proveedores       whatsapp, dirección, país, moneda, condiciones de
--                              pago, documentos (alta completa del externo).
--   · supply_acuerdos          tipoAcuerdo (wizard: prepago, depósito, pago
--                              posterior, comisión, híbrido), alcance (ítem,
--                              categoría, catálogo) y categoriaCodigo.
--   · supply_asignaciones      inicioAt, finAt, maxPorCliente, sucursalIds: una
--                              asignación de tipo OFERTA es una oferta publicable.
--   · supply_pagos             comprobantePath.
--   · supply_deposito_movimientos  ordenId: una orden pagada con un depósito.
--   · supply_ventas_directas   montoBono + bonoDerechoId (venta mixta, §17);
--                              el CHECK pasa a comisión + proveedor + bono = bruto.
--   · supply_pedidos           REEMBOLSADO, metodo, reembolsadoAt, reembolsoMotivo.
--   · Enums nuevos y ocho acciones de bitácora.
--
-- Todo aditivo e idempotente. El único DROP es el del CHECK de ventas, que se
-- vuelve a crear con la columna nueva en la misma sentencia lógica.
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE "SupplyTipoAcuerdo" AS ENUM ('COMPRA_PREPAGO', 'DEPOSITO_ABIERTO', 'PAGO_POSTERIOR', 'VENTA_COMISION', 'HIBRIDO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SupplyAlcanceAcuerdo" AS ENUM ('ITEM', 'CATEGORIA', 'CATALOGO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TYPE "SupplyPedidoEstado" ADD VALUE IF NOT EXISTS 'REEMBOLSADO';

ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_PROVEEDOR_HABILITADO';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_OFERTA_CREADA';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_LOTE_TRANSFERENCIA';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_LOTE_AJUSTE';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_LOTE_CANCELACION';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_LOTE_VENCIMIENTO_EXTENDIDO';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_PEDIDO_REEMBOLSADO';

-- ── Proveedores ─────────────────────────────────────────────────────────────
ALTER TABLE "supply_proveedores" ADD COLUMN IF NOT EXISTS "whatsapp" TEXT;
ALTER TABLE "supply_proveedores" ADD COLUMN IF NOT EXISTS "direccion" TEXT;
ALTER TABLE "supply_proveedores" ADD COLUMN IF NOT EXISTS "pais" TEXT;
ALTER TABLE "supply_proveedores" ADD COLUMN IF NOT EXISTS "moneda" TEXT DEFAULT 'DOP';
ALTER TABLE "supply_proveedores" ADD COLUMN IF NOT EXISTS "condicionesPago" TEXT;
ALTER TABLE "supply_proveedores" ADD COLUMN IF NOT EXISTS "documentos" TEXT[] NOT NULL DEFAULT '{}';

-- ── Acuerdos ────────────────────────────────────────────────────────────────
ALTER TABLE "supply_acuerdos" ADD COLUMN IF NOT EXISTS "tipoAcuerdo" "SupplyTipoAcuerdo" NOT NULL DEFAULT 'COMPRA_PREPAGO';
ALTER TABLE "supply_acuerdos" ADD COLUMN IF NOT EXISTS "alcance" "SupplyAlcanceAcuerdo" NOT NULL DEFAULT 'ITEM';
ALTER TABLE "supply_acuerdos" ADD COLUMN IF NOT EXISTS "categoriaCodigo" TEXT;
-- Los acuerdos que ya existían se clasifican por lo que ya decían.
UPDATE "supply_acuerdos" SET "tipoAcuerdo" = 'VENTA_COMISION' WHERE "modeloComercial" = 'COMISION' AND "tipoAcuerdo" = 'COMPRA_PREPAGO';
UPDATE "supply_acuerdos" SET "tipoAcuerdo" = 'HIBRIDO' WHERE "modeloComercial" = 'SUBSIDIO' AND "tipoAcuerdo" = 'COMPRA_PREPAGO';
UPDATE "supply_acuerdos" SET "tipoAcuerdo" = 'PAGO_POSTERIOR' WHERE "modeloComercial" = 'COMPRA_UNIDAD_COMPLETA' AND "modalidadPago" = 'PAGO_POR_REDENCION' AND "tipoAcuerdo" = 'COMPRA_PREPAGO';

-- ── Asignaciones = ofertas publicables ──────────────────────────────────────
ALTER TABLE "supply_asignaciones" ADD COLUMN IF NOT EXISTS "inicioAt" TIMESTAMP(3);
ALTER TABLE "supply_asignaciones" ADD COLUMN IF NOT EXISTS "finAt" TIMESTAMP(3);
ALTER TABLE "supply_asignaciones" ADD COLUMN IF NOT EXISTS "maxPorCliente" INTEGER;
ALTER TABLE "supply_asignaciones" ADD COLUMN IF NOT EXISTS "sucursalIds" TEXT[] NOT NULL DEFAULT '{}';
DO $$ BEGIN
  ALTER TABLE "supply_asignaciones" ADD CONSTRAINT "supply_asignaciones_oferta_valida"
    CHECK (("maxPorCliente" IS NULL OR "maxPorCliente" > 0) AND ("inicioAt" IS NULL OR "finAt" IS NULL OR "finAt" > "inicioAt"));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Pagos con comprobante ───────────────────────────────────────────────────
ALTER TABLE "supply_pagos" ADD COLUMN IF NOT EXISTS "comprobantePath" TEXT;

-- ── Depósito aplicado a una orden ───────────────────────────────────────────
ALTER TABLE "supply_deposito_movimientos" ADD COLUMN IF NOT EXISTS "ordenId" TEXT;
DO $$ BEGIN
  ALTER TABLE "supply_deposito_movimientos" ADD CONSTRAINT "supply_deposito_movimientos_ordenId_fkey"
    FOREIGN KEY ("ordenId") REFERENCES "supply_ordenes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "supply_deposito_movimientos_ordenId_idx" ON "supply_deposito_movimientos"("ordenId");

-- ── Venta mixta: el bono del cliente cubre parte del valor ──────────────────
ALTER TABLE "supply_ventas_directas" ADD COLUMN IF NOT EXISTS "montoBono" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "supply_ventas_directas" ADD COLUMN IF NOT EXISTS "bonoDerechoId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "supply_ventas_directas_bonoDerechoId_key" ON "supply_ventas_directas"("bonoDerechoId");
DO $$ BEGIN
  ALTER TABLE "supply_ventas_directas" ADD CONSTRAINT "supply_ventas_directas_bonoDerechoId_fkey"
    FOREIGN KEY ("bonoDerechoId") REFERENCES "supply_derechos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE "supply_ventas_directas" DROP CONSTRAINT IF EXISTS "supply_ventas_montos_validos";
DO $$ BEGIN
  ALTER TABLE "supply_ventas_directas" ADD CONSTRAINT "supply_ventas_montos_validos"
    CHECK ("cantidad" > 0 AND "precioUnitario" >= 0 AND "montoBruto" >= 0
       AND "comisionPorcentaje" >= 0 AND "comisionPorcentaje" <= 100
       AND "comisionMonto" >= 0 AND "montoProveedor" >= 0 AND "montoBono" >= 0
       AND "comisionMonto" + "montoProveedor" + "montoBono" = "montoBruto");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Pedidos: reembolso y método ─────────────────────────────────────────────
ALTER TABLE "supply_pedidos" ADD COLUMN IF NOT EXISTS "metodo" TEXT;
ALTER TABLE "supply_pedidos" ADD COLUMN IF NOT EXISTS "reembolsadoAt" TIMESTAMP(3);
ALTER TABLE "supply_pedidos" ADD COLUMN IF NOT EXISTS "reembolsoMotivo" TEXT;
