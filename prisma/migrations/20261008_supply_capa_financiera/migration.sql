-- ============================================================================
-- MEMBEGO SUPPLY · CAPA FINANCIERA          docs/membego-supply-auditoria-2026-09.md
-- ============================================================================
--
-- La auditoría del 29-09-2026 encontró que el módulo sabía comprar, repartir y
-- entregar, pero le faltaba la mitad del dinero: depósitos abiertos (§3 B),
-- facturas del proveedor (§21), cuentas por pagar y por cobrar (§15-16),
-- liquidaciones con snapshot (§17), conciliación CONTRA el proveedor (§18), la
-- venta sin precompra (§14), el perfil de proveedor externo (§5) y el
-- versionado del acuerdo (§4). Esta migración crea todo eso.
--
-- ---------------------------------------------------------------------------
-- QUÉ TOCA DE LO QUE YA EXISTÍA (todo ADITIVO, todo sobre tablas del módulo)
--
--   · supply_acuerdos          columnas de comisión, descuento, impuesto, plazo,
--                              frecuencia de corte, SLA, devoluciones, versión.
--   · supply_movimientos       saldoAntes / saldoDespues (JSON, «previous /
--                              new balance» del §8), con default '{}'.
--   · supply_ordenes           montoPagado (fondeo automático) y documentos.
--   · supply_pagos             cuentaPorPagarId, anuladoAt, anuladoMotivo.
--   · supply_asientos_financieros  liquidacionId (reclamo atómico).
--   · supply_incidencias       ventaId.
--   · supply_qr_sesiones       dispositivo, consumidoDispositivo (§12).
--   · supply_pedidos           derechoId pasa a NULL-able y entra ventaId: un
--                              pedido paga O un derecho retenido O una venta
--                              directa. El CHECK de abajo exige exactamente uno.
--   · Enums: SUSPENDIDO en el acuerdo; COMISION en el modelo comercial; siete
--     tipos y tres estados de incidencia; dos tipos de asiento; 23 acciones de
--     bitácora; tres tipos de aviso. Todo con ADD VALUE IF NOT EXISTS.
--
-- Cero DROP TABLE, cero DROP COLUMN, cero DELETE. Ninguna fila existente
-- cambia de significado.
--
-- ---------------------------------------------------------------------------
-- IDEMPOTENTE
--
-- Todo va con IF NOT EXISTS o dentro de un bloque que traga `duplicate_object`.
--
-- ---------------------------------------------------------------------------
-- LOS INVARIANTES ESTÁN EN LA BASE, NO SOLO EN EL CÓDIGO
--
-- Al final: montos no negativos, saldado ≤ neto, depósito que nunca se
-- sobreaplica, un pedido con exactamente un objeto, una liquidación viva por
-- proveedor y período, un movimiento de depósito siempre positivo. Una carrera
-- que se escape del `FOR UPDATE` se estrella contra PostgreSQL.
--
-- ---------------------------------------------------------------------------
-- MARCHA ATRÁS
--
--   DROP TABLE supply_discrepancia_notas, supply_discrepancias,
--     supply_conciliaciones, supply_liquidacion_lineas, supply_cuentas_por_cobrar,
--     supply_cuentas_por_pagar, supply_ventas_directas, supply_facturas_proveedor,
--     supply_deposito_movimientos, supply_depositos, supply_liquidaciones,
--     supply_acuerdo_versiones, supply_proveedores (en ese orden, tras quitar
--     las FKs cruzadas), y las columnas nuevas de las ocho tablas de arriba.
--   Los valores añadidos a enums no se pueden quitar en PostgreSQL sin recrear
--   el tipo; se quedan sin usar.
-- ============================================================================

DO $$ BEGIN
    CREATE TYPE "SupplyFrecuenciaCorte" AS ENUM ('SEMANAL', 'QUINCENAL', 'MENSUAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "SupplyProveedorOrigen" AS ENUM ('REGISTRADA', 'EXTERNA');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "SupplyDepositoEstado" AS ENUM ('PENDIENTE', 'ABIERTO', 'PARCIALMENTE_APLICADO', 'AGOTADO', 'CERRADO', 'CANCELADO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "SupplyDepositoMovimientoTipo" AS ENUM ('APERTURA', 'APLICACION', 'REVERSA_APLICACION', 'DEVOLUCION', 'AJUSTE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "SupplyFacturaTipo" AS ENUM ('FACTURA', 'NOTA_CREDITO', 'NOTA_DEBITO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "SupplyFacturaEstado" AS ENUM ('REGISTRADA', 'PARCIALMENTE_PAGADA', 'PAGADA', 'DISPUTADA', 'ANULADA');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "SupplyCuentaEstado" AS ENUM ('ABIERTA', 'PARCIALMENTE_SALDADA', 'SALDADA', 'DISPUTADA', 'CANCELADA');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "SupplyCuentaPorPagarOrigen" AS ENUM ('FACTURA_PROVEEDOR', 'VENTA_DIRECTA', 'AJUSTE', 'DIFERENCIA_CONCILIACION', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "SupplyCuentaPorCobrarOrigen" AS ENUM ('REEMBOLSO', 'AJUSTE', 'PENALIZACION', 'DIFERENCIA_CONCILIACION', 'SUBSIDIO', 'CARGO', 'NOTA_CREDITO', 'OTRO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "SupplyLiquidacionEstado" AS ENUM ('BORRADOR', 'CALCULADA', 'EN_REVISION', 'APROBADA', 'PAGADA', 'CONCILIADA', 'DISPUTADA', 'CANCELADA');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "SupplyLiquidacionLineaTipo" AS ENUM ('CUENTA_POR_PAGAR', 'CUENTA_POR_COBRAR', 'REDENCION', 'DEPOSITO_APLICADO', 'AJUSTE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "SupplyConciliacionEstado" AS ENUM ('ABIERTA', 'EN_REVISION', 'CERRADA');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "SupplyDiscrepanciaTipo" AS ENUM ('MISSING_REDEMPTION', 'DUPLICATE', 'VALUE_DIFFERENCE', 'PRODUCT_DIFFERENCE', 'DATE_DIFFERENCE', 'PAYMENT_DIFFERENCE', 'INTERNA');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "SupplyDiscrepanciaEstado" AS ENUM ('ABIERTA', 'EN_INVESTIGACION', 'RESUELTA', 'AJUSTADA', 'APROBADA', 'RECHAZADA');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "SupplyVentaEstado" AS ENUM ('INICIADA', 'PAGADA', 'ENTREGADA', 'CANCELADA', 'REEMBOLSADA');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_PROVEEDOR_REGISTRADO';

ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_PROVEEDOR_ACTUALIZADO';

ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_ACUERDO_VERSION';

ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_DEPOSITO_REGISTRADO';

ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_DEPOSITO_APLICADO';

ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_DEPOSITO_DEVUELTO';

ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_DEPOSITO_CERRADO';

ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_FACTURA_REGISTRADA';

ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_FACTURA_ESTADO';

ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_CXP_CREADA';

ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_CXP_ESTADO';

ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_CXC_CREADA';

ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_CXC_ESTADO';

ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_LIQUIDACION_CALCULADA';

ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_LIQUIDACION_ESTADO';

ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_CONCILIACION_ABIERTA';

ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_CONCILIACION_ESTADO';

ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_DISCREPANCIA_ESTADO';

ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_VENTA_ABIERTA';

ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_VENTA_ENTREGADA';

ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_VENTA_CANCELADA';

ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_PAGO_ANULADO';

ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_FEFO_OVERRIDE';

ALTER TYPE "NotifTipo" ADD VALUE IF NOT EXISTS 'SUPPLY_ACUERDO_POR_VENCER';

ALTER TYPE "NotifTipo" ADD VALUE IF NOT EXISTS 'SUPPLY_DEPOSITO_POR_CERRAR';

ALTER TYPE "NotifTipo" ADD VALUE IF NOT EXISTS 'SUPPLY_LIQUIDACION_PENDIENTE';

ALTER TYPE "SupplyAcuerdoEstado" ADD VALUE IF NOT EXISTS 'SUSPENDIDO';

ALTER TYPE "SupplyAsientoTipo" ADD VALUE IF NOT EXISTS 'CUENTA_POR_PAGAR';

ALTER TYPE "SupplyAsientoTipo" ADD VALUE IF NOT EXISTS 'CUENTA_POR_COBRAR';

ALTER TYPE "SupplyIncidenciaEstado" ADD VALUE IF NOT EXISTS 'ESPERANDO_PROVEEDOR';

ALTER TYPE "SupplyIncidenciaEstado" ADD VALUE IF NOT EXISTS 'ESPERANDO_CLIENTE';

ALTER TYPE "SupplyIncidenciaEstado" ADD VALUE IF NOT EXISTS 'RECHAZADA';

ALTER TYPE "SupplyIncidenciaTipo" ADD VALUE IF NOT EXISTS 'QR_INVALIDO';

ALTER TYPE "SupplyIncidenciaTipo" ADD VALUE IF NOT EXISTS 'CANTIDAD_INCORRECTA';

ALTER TYPE "SupplyIncidenciaTipo" ADD VALUE IF NOT EXISTS 'DERECHO_VENCIDO';

ALTER TYPE "SupplyIncidenciaTipo" ADD VALUE IF NOT EXISTS 'DOBLE_REDENCION';

ALTER TYPE "SupplyIncidenciaTipo" ADD VALUE IF NOT EXISTS 'SOSPECHA_FRAUDE';

ALTER TYPE "SupplyIncidenciaTipo" ADD VALUE IF NOT EXISTS 'ERROR_HUMANO';

ALTER TYPE "SupplyIncidenciaTipo" ADD VALUE IF NOT EXISTS 'RECLAMO_CLIENTE';

ALTER TYPE "SupplyModeloComercial" ADD VALUE IF NOT EXISTS 'COMISION';

ALTER TABLE "supply_acuerdos" ADD COLUMN IF NOT EXISTS "comisionPorcentaje" DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS "descuentoPorcentaje" DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS "frecuenciaCorte" "SupplyFrecuenciaCorte",
  ADD COLUMN IF NOT EXISTS "impuestoPorcentaje" DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS "metodoLiquidacion" TEXT,
  ADD COLUMN IF NOT EXISTS "plazoPagoDias" INTEGER,
  ADD COLUMN IF NOT EXISTS "politicaDevoluciones" TEXT,
  ADD COLUMN IF NOT EXISTS "slaTexto" TEXT,
  ADD COLUMN IF NOT EXISTS "suspendidoMotivo" TEXT,
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "supply_asientos_financieros" ADD COLUMN IF NOT EXISTS "liquidacionId" TEXT;

ALTER TABLE "supply_incidencias" ADD COLUMN IF NOT EXISTS "ventaId" TEXT;

ALTER TABLE "supply_movimientos" ADD COLUMN IF NOT EXISTS "saldoAntes" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "saldoDespues" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "supply_ordenes" ADD COLUMN IF NOT EXISTS "documentos" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "montoPagado" DECIMAL(14,2) NOT NULL DEFAULT 0;

ALTER TABLE "supply_pagos" ADD COLUMN IF NOT EXISTS "anuladoAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "anuladoMotivo" TEXT,
  ADD COLUMN IF NOT EXISTS "cuentaPorPagarId" TEXT;

ALTER TABLE "supply_pedidos" ADD COLUMN IF NOT EXISTS "ventaId" TEXT, ALTER COLUMN "derechoId" DROP NOT NULL;

ALTER TABLE "supply_qr_sesiones" ADD COLUMN IF NOT EXISTS "consumidoDispositivo" TEXT,
  ADD COLUMN IF NOT EXISTS "dispositivo" TEXT;

CREATE TABLE IF NOT EXISTS "supply_proveedores" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "origen" "SupplyProveedorOrigen" NOT NULL DEFAULT 'REGISTRADA',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "rnc" TEXT,
    "razonSocial" TEXT,
    "contactoNombre" TEXT,
    "contactoEmail" TEXT,
    "contactoTelefono" TEXT,
    "banco" TEXT,
    "cuentaBancaria" TEXT,
    "tipoCuenta" TEXT,
    "plazoPagoDias" INTEGER,
    "notas" TEXT,
    "convertidoAt" TIMESTAMP(3),
    "creadoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "supply_proveedores_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "supply_acuerdo_versiones" (
    "id" TEXT NOT NULL,
    "acuerdoId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "motivo" TEXT NOT NULL,
    "enmiendaId" TEXT,
    "vigenteDesde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vigenteHasta" TIMESTAMP(3),
    "creadoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "supply_acuerdo_versiones_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "supply_depositos" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "proveedorId" TEXT NOT NULL,
    "acuerdoId" TEXT,
    "pagoId" TEXT,
    "estado" "SupplyDepositoEstado" NOT NULL DEFAULT 'PENDIENTE',
    "montoOriginal" DECIMAL(14,2) NOT NULL,
    "montoAplicado" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "montoDevuelto" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "moneda" TEXT NOT NULL DEFAULT 'DOP',
    "referencia" TEXT,
    "notas" TEXT,
    "documentos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "abiertoAt" TIMESTAMP(3),
    "cierraAt" TIMESTAMP(3),
    "cerradoAt" TIMESTAMP(3),
    "cerradoMotivo" TEXT,
    "registradoPorId" TEXT,
    "aprobadoPorId" TEXT,
    "claveIdempotencia" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "supply_depositos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "supply_deposito_movimientos" (
    "id" TEXT NOT NULL,
    "depositoId" TEXT NOT NULL,
    "tipo" "SupplyDepositoMovimientoTipo" NOT NULL,
    "monto" DECIMAL(14,2) NOT NULL,
    "saldoAntes" DECIMAL(14,2) NOT NULL,
    "saldoDespues" DECIMAL(14,2) NOT NULL,
    "facturaId" TEXT,
    "cuentaPorPagarId" TEXT,
    "liquidacionId" TEXT,
    "motivo" TEXT,
    "referencia" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "supply_deposito_movimientos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "supply_facturas_proveedor" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "proveedorId" TEXT NOT NULL,
    "acuerdoId" TEXT,
    "ordenId" TEXT,
    "tipo" "SupplyFacturaTipo" NOT NULL DEFAULT 'FACTURA',
    "estado" "SupplyFacturaEstado" NOT NULL DEFAULT 'REGISTRADA',
    "fechaEmision" TIMESTAMP(3) NOT NULL,
    "fechaVencimiento" TIMESTAMP(3),
    "subtotal" DECIMAL(14,2) NOT NULL,
    "impuestos" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "moneda" TEXT NOT NULL DEFAULT 'DOP',
    "montoSaldado" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "documentoPath" TEXT,
    "notas" TEXT,
    "registradoPorId" TEXT,
    "claveIdempotencia" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "supply_facturas_proveedor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "supply_cuentas_por_pagar" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "proveedorId" TEXT NOT NULL,
    "acuerdoId" TEXT,
    "origen" "SupplyCuentaPorPagarOrigen" NOT NULL,
    "descripcion" TEXT NOT NULL,
    "facturaId" TEXT,
    "ventaId" TEXT,
    "discrepanciaId" TEXT,
    "montoBruto" DECIMAL(14,2) NOT NULL,
    "comision" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "descuentos" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "impuestos" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "montoNeto" DECIMAL(14,2) NOT NULL,
    "montoSaldado" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "moneda" TEXT NOT NULL DEFAULT 'DOP',
    "estado" "SupplyCuentaEstado" NOT NULL DEFAULT 'ABIERTA',
    "vencimientoAt" TIMESTAMP(3),
    "liquidacionId" TEXT,
    "disputaMotivo" TEXT,
    "notas" TEXT,
    "documentos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "creadoPorId" TEXT,
    "claveIdempotencia" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "supply_cuentas_por_pagar_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "supply_cuentas_por_cobrar" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "proveedorId" TEXT NOT NULL,
    "acuerdoId" TEXT,
    "origen" "SupplyCuentaPorCobrarOrigen" NOT NULL,
    "descripcion" TEXT NOT NULL,
    "facturaId" TEXT,
    "discrepanciaId" TEXT,
    "montoNeto" DECIMAL(14,2) NOT NULL,
    "montoSaldado" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "moneda" TEXT NOT NULL DEFAULT 'DOP',
    "estado" "SupplyCuentaEstado" NOT NULL DEFAULT 'ABIERTA',
    "vencimientoAt" TIMESTAMP(3),
    "liquidacionId" TEXT,
    "disputaMotivo" TEXT,
    "notas" TEXT,
    "documentos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "creadoPorId" TEXT,
    "claveIdempotencia" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "supply_cuentas_por_cobrar_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "supply_liquidaciones" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "proveedorId" TEXT NOT NULL,
    "acuerdoId" TEXT,
    "acuerdoVersion" INTEGER,
    "estado" "SupplyLiquidacionEstado" NOT NULL DEFAULT 'BORRADOR',
    "periodoDesde" TIMESTAMP(3) NOT NULL,
    "periodoHasta" TIMESTAMP(3) NOT NULL,
    "moneda" TEXT NOT NULL DEFAULT 'DOP',
    "ventasBrutas" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "comisionMembego" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "montoProveedor" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "redencionesMonto" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "reembolsos" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "ajustes" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "impuestos" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "depositoAplicado" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "netoLiquidar" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "redenciones" INTEGER NOT NULL DEFAULT 0,
    "ventas" INTEGER NOT NULL DEFAULT 0,
    "snapshot" JSONB NOT NULL DEFAULT '{}',
    "pagoId" TEXT,
    "calculadaPorId" TEXT,
    "calculadaAt" TIMESTAMP(3),
    "aprobadaPorId" TEXT,
    "aprobadaAt" TIMESTAMP(3),
    "pagadaAt" TIMESTAMP(3),
    "conciliadaAt" TIMESTAMP(3),
    "disputaMotivo" TEXT,
    "notas" TEXT,
    "documentos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "claveIdempotencia" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "supply_liquidaciones_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "supply_liquidacion_lineas" (
    "id" TEXT NOT NULL,
    "liquidacionId" TEXT NOT NULL,
    "tipo" "SupplyLiquidacionLineaTipo" NOT NULL,
    "referencia" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "monto" DECIMAL(14,2) NOT NULL,
    "cuentaPorPagarId" TEXT,
    "cuentaPorCobrarId" TEXT,
    "redencionId" TEXT,
    "depositoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "supply_liquidacion_lineas_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "supply_conciliaciones" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "proveedorId" TEXT NOT NULL,
    "acuerdoId" TEXT,
    "liquidacionId" TEXT,
    "estado" "SupplyConciliacionEstado" NOT NULL DEFAULT 'ABIERTA',
    "periodoDesde" TIMESTAMP(3) NOT NULL,
    "periodoHasta" TIMESTAMP(3) NOT NULL,
    "membegoRedenciones" INTEGER NOT NULL DEFAULT 0,
    "membegoMonto" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "membegoVentas" INTEGER NOT NULL DEFAULT 0,
    "membegoVentasMonto" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "proveedorRedenciones" INTEGER NOT NULL DEFAULT 0,
    "proveedorMonto" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "proveedorVentas" INTEGER NOT NULL DEFAULT 0,
    "proveedorVentasMonto" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "proveedorDetalle" JSONB NOT NULL DEFAULT '{}',
    "notas" TEXT,
    "documentos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "creadoPorId" TEXT,
    "cerradoPorId" TEXT,
    "cerradaAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "supply_conciliaciones_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "supply_discrepancias" (
    "id" TEXT NOT NULL,
    "conciliacionId" TEXT NOT NULL,
    "tipo" "SupplyDiscrepanciaTipo" NOT NULL,
    "estado" "SupplyDiscrepanciaEstado" NOT NULL DEFAULT 'ABIERTA',
    "titulo" TEXT NOT NULL,
    "detalle" TEXT NOT NULL,
    "cantidadMembego" INTEGER,
    "cantidadProveedor" INTEGER,
    "montoMembego" DECIMAL(14,2),
    "montoProveedor" DECIMAL(14,2),
    "montoDiferencia" DECIMAL(14,2),
    "entidad" TEXT,
    "entidadId" TEXT,
    "redencionId" TEXT,
    "ventaId" TEXT,
    "resolucion" TEXT,
    "resueltoPorId" TEXT,
    "resueltoAt" TIMESTAMP(3),
    "aprobadoPorId" TEXT,
    "aprobadoAt" TIMESTAMP(3),
    "documentos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "supply_discrepancias_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "supply_discrepancia_notas" (
    "id" TEXT NOT NULL,
    "discrepanciaId" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "documentoPath" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "supply_discrepancia_notas_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "supply_ventas_directas" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "proveedorId" TEXT NOT NULL,
    "acuerdoId" TEXT NOT NULL,
    "acuerdoVersion" INTEGER NOT NULL,
    "clienteId" TEXT NOT NULL,
    "sucursalId" TEXT,
    "estado" "SupplyVentaEstado" NOT NULL DEFAULT 'INICIADA',
    "itemNombre" TEXT NOT NULL,
    "varianteEtiqueta" TEXT,
    "cantidad" INTEGER NOT NULL DEFAULT 1,
    "precioUnitario" DECIMAL(12,2) NOT NULL,
    "montoBruto" DECIMAL(12,2) NOT NULL,
    "comisionPorcentaje" DECIMAL(5,2) NOT NULL,
    "comisionMonto" DECIMAL(12,2) NOT NULL,
    "montoProveedor" DECIMAL(12,2) NOT NULL,
    "moneda" TEXT NOT NULL DEFAULT 'DOP',
    "codigoEntrega" TEXT NOT NULL,
    "pagadaAt" TIMESTAMP(3),
    "entregadaAt" TIMESTAMP(3),
    "entregadaPorId" TEXT,
    "canceladaAt" TIMESTAMP(3),
    "canceladaMotivo" TEXT,
    "claveIdempotencia" TEXT,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "supply_ventas_directas_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "supply_proveedores_companyId_key" ON "supply_proveedores"("companyId");

CREATE INDEX IF NOT EXISTS "supply_proveedores_origen_activo_idx" ON "supply_proveedores"("origen", "activo");

CREATE UNIQUE INDEX IF NOT EXISTS "supply_acuerdo_versiones_enmiendaId_key" ON "supply_acuerdo_versiones"("enmiendaId");

CREATE UNIQUE INDEX IF NOT EXISTS "supply_acuerdo_versiones_acuerdoId_version_key" ON "supply_acuerdo_versiones"("acuerdoId", "version");

CREATE UNIQUE INDEX IF NOT EXISTS "supply_depositos_codigo_key" ON "supply_depositos"("codigo");

CREATE UNIQUE INDEX IF NOT EXISTS "supply_depositos_pagoId_key" ON "supply_depositos"("pagoId");

CREATE UNIQUE INDEX IF NOT EXISTS "supply_depositos_claveIdempotencia_key" ON "supply_depositos"("claveIdempotencia");

CREATE INDEX IF NOT EXISTS "supply_depositos_proveedorId_estado_idx" ON "supply_depositos"("proveedorId", "estado");

CREATE INDEX IF NOT EXISTS "supply_depositos_estado_cierraAt_idx" ON "supply_depositos"("estado", "cierraAt");

CREATE INDEX IF NOT EXISTS "supply_deposito_movimientos_depositoId_createdAt_idx" ON "supply_deposito_movimientos"("depositoId", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "supply_facturas_proveedor_codigo_key" ON "supply_facturas_proveedor"("codigo");

CREATE UNIQUE INDEX IF NOT EXISTS "supply_facturas_proveedor_claveIdempotencia_key" ON "supply_facturas_proveedor"("claveIdempotencia");

CREATE INDEX IF NOT EXISTS "supply_facturas_proveedor_proveedorId_estado_idx" ON "supply_facturas_proveedor"("proveedorId", "estado");

CREATE INDEX IF NOT EXISTS "supply_facturas_proveedor_estado_fechaVencimiento_idx" ON "supply_facturas_proveedor"("estado", "fechaVencimiento");

CREATE UNIQUE INDEX IF NOT EXISTS "supply_facturas_proveedor_proveedorId_numero_key" ON "supply_facturas_proveedor"("proveedorId", "numero");

CREATE UNIQUE INDEX IF NOT EXISTS "supply_cuentas_por_pagar_codigo_key" ON "supply_cuentas_por_pagar"("codigo");

CREATE UNIQUE INDEX IF NOT EXISTS "supply_cuentas_por_pagar_facturaId_key" ON "supply_cuentas_por_pagar"("facturaId");

CREATE UNIQUE INDEX IF NOT EXISTS "supply_cuentas_por_pagar_ventaId_key" ON "supply_cuentas_por_pagar"("ventaId");

CREATE UNIQUE INDEX IF NOT EXISTS "supply_cuentas_por_pagar_discrepanciaId_key" ON "supply_cuentas_por_pagar"("discrepanciaId");

CREATE UNIQUE INDEX IF NOT EXISTS "supply_cuentas_por_pagar_claveIdempotencia_key" ON "supply_cuentas_por_pagar"("claveIdempotencia");

CREATE INDEX IF NOT EXISTS "supply_cuentas_por_pagar_proveedorId_estado_idx" ON "supply_cuentas_por_pagar"("proveedorId", "estado");

CREATE INDEX IF NOT EXISTS "supply_cuentas_por_pagar_estado_vencimientoAt_idx" ON "supply_cuentas_por_pagar"("estado", "vencimientoAt");

CREATE INDEX IF NOT EXISTS "supply_cuentas_por_pagar_liquidacionId_idx" ON "supply_cuentas_por_pagar"("liquidacionId");

CREATE UNIQUE INDEX IF NOT EXISTS "supply_cuentas_por_cobrar_codigo_key" ON "supply_cuentas_por_cobrar"("codigo");

CREATE UNIQUE INDEX IF NOT EXISTS "supply_cuentas_por_cobrar_facturaId_key" ON "supply_cuentas_por_cobrar"("facturaId");

CREATE UNIQUE INDEX IF NOT EXISTS "supply_cuentas_por_cobrar_discrepanciaId_key" ON "supply_cuentas_por_cobrar"("discrepanciaId");

CREATE UNIQUE INDEX IF NOT EXISTS "supply_cuentas_por_cobrar_claveIdempotencia_key" ON "supply_cuentas_por_cobrar"("claveIdempotencia");

CREATE INDEX IF NOT EXISTS "supply_cuentas_por_cobrar_proveedorId_estado_idx" ON "supply_cuentas_por_cobrar"("proveedorId", "estado");

CREATE INDEX IF NOT EXISTS "supply_cuentas_por_cobrar_estado_vencimientoAt_idx" ON "supply_cuentas_por_cobrar"("estado", "vencimientoAt");

CREATE INDEX IF NOT EXISTS "supply_cuentas_por_cobrar_liquidacionId_idx" ON "supply_cuentas_por_cobrar"("liquidacionId");

CREATE UNIQUE INDEX IF NOT EXISTS "supply_liquidaciones_codigo_key" ON "supply_liquidaciones"("codigo");

CREATE UNIQUE INDEX IF NOT EXISTS "supply_liquidaciones_pagoId_key" ON "supply_liquidaciones"("pagoId");

CREATE UNIQUE INDEX IF NOT EXISTS "supply_liquidaciones_claveIdempotencia_key" ON "supply_liquidaciones"("claveIdempotencia");

CREATE INDEX IF NOT EXISTS "supply_liquidaciones_proveedorId_estado_idx" ON "supply_liquidaciones"("proveedorId", "estado");

CREATE INDEX IF NOT EXISTS "supply_liquidaciones_estado_periodoHasta_idx" ON "supply_liquidaciones"("estado", "periodoHasta");

CREATE INDEX IF NOT EXISTS "supply_liquidacion_lineas_liquidacionId_idx" ON "supply_liquidacion_lineas"("liquidacionId");

CREATE INDEX IF NOT EXISTS "supply_liquidacion_lineas_redencionId_idx" ON "supply_liquidacion_lineas"("redencionId");

CREATE UNIQUE INDEX IF NOT EXISTS "supply_conciliaciones_codigo_key" ON "supply_conciliaciones"("codigo");

CREATE INDEX IF NOT EXISTS "supply_conciliaciones_proveedorId_estado_idx" ON "supply_conciliaciones"("proveedorId", "estado");

CREATE INDEX IF NOT EXISTS "supply_conciliaciones_estado_periodoHasta_idx" ON "supply_conciliaciones"("estado", "periodoHasta");

CREATE INDEX IF NOT EXISTS "supply_discrepancias_conciliacionId_estado_idx" ON "supply_discrepancias"("conciliacionId", "estado");

CREATE INDEX IF NOT EXISTS "supply_discrepancia_notas_discrepanciaId_createdAt_idx" ON "supply_discrepancia_notas"("discrepanciaId", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "supply_ventas_directas_numero_key" ON "supply_ventas_directas"("numero");

CREATE UNIQUE INDEX IF NOT EXISTS "supply_ventas_directas_codigoEntrega_key" ON "supply_ventas_directas"("codigoEntrega");

CREATE UNIQUE INDEX IF NOT EXISTS "supply_ventas_directas_claveIdempotencia_key" ON "supply_ventas_directas"("claveIdempotencia");

CREATE INDEX IF NOT EXISTS "supply_ventas_directas_proveedorId_estado_idx" ON "supply_ventas_directas"("proveedorId", "estado");

CREATE INDEX IF NOT EXISTS "supply_ventas_directas_clienteId_estado_idx" ON "supply_ventas_directas"("clienteId", "estado");

CREATE INDEX IF NOT EXISTS "supply_ventas_directas_acuerdoId_createdAt_idx" ON "supply_ventas_directas"("acuerdoId", "createdAt");

CREATE INDEX IF NOT EXISTS "supply_ventas_directas_estado_entregadaAt_idx" ON "supply_ventas_directas"("estado", "entregadaAt");

CREATE INDEX IF NOT EXISTS "supply_asientos_financieros_liquidacionId_idx" ON "supply_asientos_financieros"("liquidacionId");

CREATE INDEX IF NOT EXISTS "supply_pagos_ordenId_idx" ON "supply_pagos"("ordenId");

CREATE UNIQUE INDEX IF NOT EXISTS "supply_pedidos_ventaId_key" ON "supply_pedidos"("ventaId");

DO $$ BEGIN
    ALTER TABLE "supply_incidencias" ADD CONSTRAINT "supply_incidencias_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "supply_ventas_directas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_pagos" ADD CONSTRAINT "supply_pagos_cuentaPorPagarId_fkey" FOREIGN KEY ("cuentaPorPagarId") REFERENCES "supply_cuentas_por_pagar"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_asientos_financieros" ADD CONSTRAINT "supply_asientos_financieros_liquidacionId_fkey" FOREIGN KEY ("liquidacionId") REFERENCES "supply_liquidaciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_pedidos" ADD CONSTRAINT "supply_pedidos_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "supply_ventas_directas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_proveedores" ADD CONSTRAINT "supply_proveedores_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_proveedores" ADD CONSTRAINT "supply_proveedores_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_acuerdo_versiones" ADD CONSTRAINT "supply_acuerdo_versiones_acuerdoId_fkey" FOREIGN KEY ("acuerdoId") REFERENCES "supply_acuerdos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_acuerdo_versiones" ADD CONSTRAINT "supply_acuerdo_versiones_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_depositos" ADD CONSTRAINT "supply_depositos_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_depositos" ADD CONSTRAINT "supply_depositos_acuerdoId_fkey" FOREIGN KEY ("acuerdoId") REFERENCES "supply_acuerdos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_depositos" ADD CONSTRAINT "supply_depositos_pagoId_fkey" FOREIGN KEY ("pagoId") REFERENCES "supply_pagos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_depositos" ADD CONSTRAINT "supply_depositos_registradoPorId_fkey" FOREIGN KEY ("registradoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_depositos" ADD CONSTRAINT "supply_depositos_aprobadoPorId_fkey" FOREIGN KEY ("aprobadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_deposito_movimientos" ADD CONSTRAINT "supply_deposito_movimientos_depositoId_fkey" FOREIGN KEY ("depositoId") REFERENCES "supply_depositos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_deposito_movimientos" ADD CONSTRAINT "supply_deposito_movimientos_facturaId_fkey" FOREIGN KEY ("facturaId") REFERENCES "supply_facturas_proveedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_deposito_movimientos" ADD CONSTRAINT "supply_deposito_movimientos_cuentaPorPagarId_fkey" FOREIGN KEY ("cuentaPorPagarId") REFERENCES "supply_cuentas_por_pagar"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_deposito_movimientos" ADD CONSTRAINT "supply_deposito_movimientos_liquidacionId_fkey" FOREIGN KEY ("liquidacionId") REFERENCES "supply_liquidaciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_deposito_movimientos" ADD CONSTRAINT "supply_deposito_movimientos_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_facturas_proveedor" ADD CONSTRAINT "supply_facturas_proveedor_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_facturas_proveedor" ADD CONSTRAINT "supply_facturas_proveedor_acuerdoId_fkey" FOREIGN KEY ("acuerdoId") REFERENCES "supply_acuerdos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_facturas_proveedor" ADD CONSTRAINT "supply_facturas_proveedor_ordenId_fkey" FOREIGN KEY ("ordenId") REFERENCES "supply_ordenes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_facturas_proveedor" ADD CONSTRAINT "supply_facturas_proveedor_registradoPorId_fkey" FOREIGN KEY ("registradoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_cuentas_por_pagar" ADD CONSTRAINT "supply_cuentas_por_pagar_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_cuentas_por_pagar" ADD CONSTRAINT "supply_cuentas_por_pagar_acuerdoId_fkey" FOREIGN KEY ("acuerdoId") REFERENCES "supply_acuerdos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_cuentas_por_pagar" ADD CONSTRAINT "supply_cuentas_por_pagar_facturaId_fkey" FOREIGN KEY ("facturaId") REFERENCES "supply_facturas_proveedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_cuentas_por_pagar" ADD CONSTRAINT "supply_cuentas_por_pagar_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "supply_ventas_directas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_cuentas_por_pagar" ADD CONSTRAINT "supply_cuentas_por_pagar_discrepanciaId_fkey" FOREIGN KEY ("discrepanciaId") REFERENCES "supply_discrepancias"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_cuentas_por_pagar" ADD CONSTRAINT "supply_cuentas_por_pagar_liquidacionId_fkey" FOREIGN KEY ("liquidacionId") REFERENCES "supply_liquidaciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_cuentas_por_pagar" ADD CONSTRAINT "supply_cuentas_por_pagar_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_cuentas_por_cobrar" ADD CONSTRAINT "supply_cuentas_por_cobrar_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_cuentas_por_cobrar" ADD CONSTRAINT "supply_cuentas_por_cobrar_acuerdoId_fkey" FOREIGN KEY ("acuerdoId") REFERENCES "supply_acuerdos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_cuentas_por_cobrar" ADD CONSTRAINT "supply_cuentas_por_cobrar_facturaId_fkey" FOREIGN KEY ("facturaId") REFERENCES "supply_facturas_proveedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_cuentas_por_cobrar" ADD CONSTRAINT "supply_cuentas_por_cobrar_discrepanciaId_fkey" FOREIGN KEY ("discrepanciaId") REFERENCES "supply_discrepancias"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_cuentas_por_cobrar" ADD CONSTRAINT "supply_cuentas_por_cobrar_liquidacionId_fkey" FOREIGN KEY ("liquidacionId") REFERENCES "supply_liquidaciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_cuentas_por_cobrar" ADD CONSTRAINT "supply_cuentas_por_cobrar_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_liquidaciones" ADD CONSTRAINT "supply_liquidaciones_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_liquidaciones" ADD CONSTRAINT "supply_liquidaciones_acuerdoId_fkey" FOREIGN KEY ("acuerdoId") REFERENCES "supply_acuerdos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_liquidaciones" ADD CONSTRAINT "supply_liquidaciones_pagoId_fkey" FOREIGN KEY ("pagoId") REFERENCES "supply_pagos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_liquidaciones" ADD CONSTRAINT "supply_liquidaciones_calculadaPorId_fkey" FOREIGN KEY ("calculadaPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_liquidaciones" ADD CONSTRAINT "supply_liquidaciones_aprobadaPorId_fkey" FOREIGN KEY ("aprobadaPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_liquidacion_lineas" ADD CONSTRAINT "supply_liquidacion_lineas_liquidacionId_fkey" FOREIGN KEY ("liquidacionId") REFERENCES "supply_liquidaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_conciliaciones" ADD CONSTRAINT "supply_conciliaciones_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_conciliaciones" ADD CONSTRAINT "supply_conciliaciones_acuerdoId_fkey" FOREIGN KEY ("acuerdoId") REFERENCES "supply_acuerdos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_conciliaciones" ADD CONSTRAINT "supply_conciliaciones_liquidacionId_fkey" FOREIGN KEY ("liquidacionId") REFERENCES "supply_liquidaciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_conciliaciones" ADD CONSTRAINT "supply_conciliaciones_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_conciliaciones" ADD CONSTRAINT "supply_conciliaciones_cerradoPorId_fkey" FOREIGN KEY ("cerradoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_discrepancias" ADD CONSTRAINT "supply_discrepancias_conciliacionId_fkey" FOREIGN KEY ("conciliacionId") REFERENCES "supply_conciliaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_discrepancias" ADD CONSTRAINT "supply_discrepancias_resueltoPorId_fkey" FOREIGN KEY ("resueltoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_discrepancias" ADD CONSTRAINT "supply_discrepancias_aprobadoPorId_fkey" FOREIGN KEY ("aprobadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_discrepancia_notas" ADD CONSTRAINT "supply_discrepancia_notas_discrepanciaId_fkey" FOREIGN KEY ("discrepanciaId") REFERENCES "supply_discrepancias"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_discrepancia_notas" ADD CONSTRAINT "supply_discrepancia_notas_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_ventas_directas" ADD CONSTRAINT "supply_ventas_directas_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_ventas_directas" ADD CONSTRAINT "supply_ventas_directas_acuerdoId_proveedorId_fkey" FOREIGN KEY ("acuerdoId", "proveedorId") REFERENCES "supply_acuerdos"("id", "proveedorId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_ventas_directas" ADD CONSTRAINT "supply_ventas_directas_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_ventas_directas" ADD CONSTRAINT "supply_ventas_directas_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "sucursales"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_ventas_directas" ADD CONSTRAINT "supply_ventas_directas_entregadaPorId_fkey" FOREIGN KEY ("entregadaPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- INVARIANTES A NIVEL DE BASE
-- ============================================================================

-- ── Un pedido paga exactamente UNA cosa: un derecho retenido o una venta ────
DO $$ BEGIN
    ALTER TABLE "supply_pedidos" ADD CONSTRAINT "supply_pedidos_un_solo_objeto"
      CHECK (("derechoId" IS NOT NULL)::int + ("ventaId" IS NOT NULL)::int = 1);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Depósito: nunca se aplica ni se devuelve más de lo que entró ────────────
DO $$ BEGIN
    ALTER TABLE "supply_depositos" ADD CONSTRAINT "supply_depositos_saldo_valido"
      CHECK ("montoOriginal" > 0 AND "montoAplicado" >= 0 AND "montoDevuelto" >= 0
         AND "montoAplicado" + "montoDevuelto" <= "montoOriginal");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_deposito_movimientos" ADD CONSTRAINT "supply_deposito_movimientos_monto_positivo"
      CHECK ("monto" > 0 AND "saldoAntes" >= 0 AND "saldoDespues" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Cuentas: lo saldado nunca supera lo debido ──────────────────────────────
DO $$ BEGIN
    ALTER TABLE "supply_cuentas_por_pagar" ADD CONSTRAINT "supply_cxp_montos_validos"
      CHECK ("montoBruto" >= 0 AND "comision" >= 0 AND "descuentos" >= 0
         AND "impuestos" >= 0 AND "montoNeto" >= 0 AND "montoSaldado" >= 0
         AND "montoSaldado" <= "montoNeto");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_cuentas_por_cobrar" ADD CONSTRAINT "supply_cxc_montos_validos"
      CHECK ("montoNeto" >= 0 AND "montoSaldado" >= 0 AND "montoSaldado" <= "montoNeto");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Una cuenta SALDADA lo está del todo; una ABIERTA no tiene nada saldado ──
DO $$ BEGIN
    ALTER TABLE "supply_cuentas_por_pagar" ADD CONSTRAINT "supply_cxp_estado_coherente"
      CHECK (("estado" <> 'SALDADA' OR "montoSaldado" = "montoNeto")
         AND ("estado" <> 'ABIERTA' OR "montoSaldado" = 0));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Facturas y ventas: aritmética que no se puede romper ────────────────────
DO $$ BEGIN
    ALTER TABLE "supply_facturas_proveedor" ADD CONSTRAINT "supply_facturas_montos_validos"
      CHECK ("subtotal" >= 0 AND "impuestos" >= 0 AND "total" >= 0
         AND "montoSaldado" >= 0 AND "montoSaldado" <= "total");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_ventas_directas" ADD CONSTRAINT "supply_ventas_montos_validos"
      CHECK ("cantidad" > 0 AND "precioUnitario" >= 0 AND "montoBruto" >= 0
         AND "comisionPorcentaje" >= 0 AND "comisionPorcentaje" <= 100
         AND "comisionMonto" >= 0 AND "montoProveedor" >= 0
         AND "comisionMonto" + "montoProveedor" = "montoBruto");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Una venta ENTREGADA dice quién y cuándo ─────────────────────────────────
DO $$ BEGIN
    ALTER TABLE "supply_ventas_directas" ADD CONSTRAINT "supply_ventas_entrega_completa"
      CHECK ("estado" <> 'ENTREGADA' OR "entregadaAt" IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── El acuerdo a comisión declara su comisión ───────────────────────────────
DO $$ BEGIN
    ALTER TABLE "supply_acuerdos" ADD CONSTRAINT "supply_acuerdos_porcentajes_validos"
      CHECK (("comisionPorcentaje" IS NULL OR ("comisionPorcentaje" >= 0 AND "comisionPorcentaje" <= 100))
         AND ("descuentoPorcentaje" IS NULL OR ("descuentoPorcentaje" >= 0 AND "descuentoPorcentaje" <= 100))
         AND ("impuestoPorcentaje" IS NULL OR ("impuestoPorcentaje" >= 0 AND "impuestoPorcentaje" <= 100))
         AND "version" >= 1);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Una liquidación viva por proveedor y período ────────────────────────────
--
-- Dos personas calculando el mismo corte a la vez: la segunda choca aquí. Las
-- canceladas no cuentan, para poder rehacer un corte que se descartó.
CREATE UNIQUE INDEX IF NOT EXISTS "supply_liquidaciones_periodo_viva"
  ON "supply_liquidaciones" ("proveedorId", "periodoDesde", "periodoHasta")
  WHERE "estado" <> 'CANCELADA';

-- ── Una redención entra en UNA liquidación ──────────────────────────────────
--
-- No es un índice sobre las líneas: una liquidación CANCELADA conserva sus
-- líneas como historia y la redención tiene que poder entrar en el corte
-- siguiente. El reclamo es sobre el ASIENTO (`supply_asientos_financieros.
-- liquidacionId`), con `UPDATE … WHERE "liquidacionId" IS NULL`, que es
-- atómico, y cancelar la liquidación lo suelta.

-- ── Rendimiento: los recorridos del cron y del tablero ──────────────────────
CREATE INDEX IF NOT EXISTS "supply_depositos_abiertos_cierre"
  ON "supply_depositos" ("cierraAt") WHERE "estado" IN ('ABIERTO', 'PARCIALMENTE_APLICADO');

CREATE INDEX IF NOT EXISTS "supply_cxp_abiertas_vencimiento"
  ON "supply_cuentas_por_pagar" ("vencimientoAt") WHERE "estado" IN ('ABIERTA', 'PARCIALMENTE_SALDADA');

CREATE INDEX IF NOT EXISTS "supply_acuerdos_activos_fin"
  ON "supply_acuerdos" ("finAt") WHERE "estado" = 'ACTIVO';

-- (El índice `[estado, comprobanteAt]` que el esquema declaraba se retiró del
-- esquema en #523: la cola de revisión usa el índice PARCIAL de la migración
-- 20261006 y no hace falta otro.)
