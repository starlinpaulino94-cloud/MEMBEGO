-- ============================================================================
-- MEMBEGO SUPPLY · inventario patrocinado     docs/membego-supply-architecture.md
-- ============================================================================
--
-- Crea el dominio con el que Membego compra derechos de consumo a las empresas
-- afiliadas y los reparte: acuerdos, órdenes, lotes, LEDGER de derechos,
-- asignaciones, derechos de cliente, vouchers, QR, reservas, redenciones,
-- incidencias, pagos y ledger financiero del proveedor.
--
-- ---------------------------------------------------------------------------
-- NO TOCA NADA EXISTENTE
--
-- Solo CREA. Cero ALTER sobre tablas vivas, cero DROP, cero UPDATE de datos:
-- las únicas columnas nuevas fuera de `supply_*` son ninguna —las capacidades
-- del proveedor viajan en `companies.capacidades`, que ya es JSON—. Por eso se
-- puede aplicar con la aplicación corriendo y revertir borrando las tablas.
--
-- ROLLBACK: DROP TABLE de las quince tablas en orden inverso + DROP TYPE de los
-- catorce enums. Ninguna fila de otro módulo depende de ellas.
--
-- ---------------------------------------------------------------------------
-- IDEMPOTENTE
--
-- Todo va con IF NOT EXISTS o dentro de un bloque que traga `duplicate_object`.
-- Aplicarla dos veces no falla, que es lo que permite sellarla sin miedo si la
-- primera pasada se cortó a media tabla.
--
-- ---------------------------------------------------------------------------
-- LOS INVARIANTES ESTÁN EN LA BASE, NO SOLO EN EL CÓDIGO (Fase 45)
--
-- Al final del archivo hay CHECKs que hacen IMPOSIBLE el sobregiro aunque la
-- aplicación se equivoque: cubetas no negativas, la suma de cubetas igual a lo
-- comprado, cantidades de movimiento positivas, y emitidas + liberadas nunca
-- por encima de lo asignado. Una condición de carrera que se escape del
-- `FOR UPDATE` se estrella contra Postgres en vez de regalar una unidad que no
-- existe.
-- ============================================================================

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyTipo" AS ENUM ('ON_DEMAND', 'STOCK_RESERVADO', 'CAPACIDAD_SERVICIO', 'CAPACIDAD_AGENDADA');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyModeloComercial" AS ENUM ('COMPRA_UNIDAD_COMPLETA', 'SUBSIDIO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyModalidadPago" AS ENUM ('PREPAGO_TOTAL', 'PREPAGO_PARCIAL', 'PAGO_POR_REDENCION', 'SUBSIDIO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyPoliticaSobrante" AS ENUM ('EXPIRAR', 'EXTENDER', 'REEMBOLSO', 'CREDITO_COMERCIO', 'CONVERTIR', 'RENEGOCIAR');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyAcuerdoEstado" AS ENUM ('BORRADOR', 'PENDIENTE_APROBACION', 'APROBADO', 'ACTIVO', 'COMPLETADO', 'VENCIDO', 'CANCELADO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyOrdenEstado" AS ENUM ('BORRADOR', 'PENDIENTE_APROBACION', 'APROBADA', 'CONFIRMADA', 'PARCIALMENTE_FONDEADA', 'FONDEADA', 'ACTIVA', 'COMPLETADA', 'CANCELADA');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyLoteEstado" AS ENUM ('PROGRAMADO', 'ACTIVO', 'AGOTADO', 'VENCIDO', 'CANCELADO', 'CERRADO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyCubeta" AS ENUM ('DISPONIBLE', 'ASIGNADO', 'RETENIDO', 'EMITIDO', 'REDIMIDO', 'CERRADO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyMovimientoTipo" AS ENUM ('COMPRA', 'ASIGNACION', 'LIBERACION_ASIGNACION', 'RETENCION', 'LIBERACION_RETENCION', 'EMISION', 'DEVOLUCION_EMISION', 'REDENCION', 'REVERSA_REDENCION', 'EXPIRACION', 'CANCELACION', 'AJUSTE', 'TRANSFERENCIA');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyOrigenDerecho" AS ENUM ('CAMPANA_BIENVENIDA', 'REGALO', 'OFERTA', 'COMPRA', 'MEMBRESIA', 'RECOMPENSA', 'REFERIDO', 'INFLUENCER', 'SOPORTE', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyDerechoEstado" AS ENUM ('RETENIDO', 'ACTIVO', 'REDIMIDO', 'VENCIDO', 'CANCELADO', 'REVOCADO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyVoucherEstado" AS ENUM ('ACTIVO', 'REDIMIDO', 'VENCIDO', 'CANCELADO', 'REVOCADO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyIncidenciaTipo" AS ENUM ('BENEFICIO_NEGADO', 'PRODUCTO_NO_DISPONIBLE', 'PRODUCTO_INCORRECTO', 'COBRO_INDEBIDO', 'EMPRESA_CERRADA', 'CALIDAD_INSUFICIENTE', 'SUCURSAL_NO_ACEPTO', 'OTRO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyIncidenciaEstado" AS ENUM ('ABIERTA', 'EN_REVISION', 'RESUELTA_CLIENTE', 'RESUELTA_COMERCIO', 'RESUELTA_MEMBEGO', 'CERRADA');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyAsientoTipo" AS ENUM ('COMPROMISO_COMPRA', 'DEPOSITO', 'REDENCION_POR_PAGAR', 'PAGO', 'REEMBOLSO', 'CREDITO', 'AJUSTE', 'REVERSA');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyPagoTipo" AS ENUM ('ANTICIPO', 'DEPOSITO', 'LIQUIDACION_REDENCIONES', 'LIQUIDACION_FINAL', 'REEMBOLSO', 'AJUSTE', 'CREDITO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_acuerdos" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "proveedorId" TEXT NOT NULL,
    "estado" "SupplyAcuerdoEstado" NOT NULL DEFAULT 'BORRADOR',
    "tipo" "SupplyTipo" NOT NULL,
    "modeloComercial" "SupplyModeloComercial" NOT NULL DEFAULT 'COMPRA_UNIDAD_COMPLETA',
    "modalidadPago" "SupplyModalidadPago" NOT NULL DEFAULT 'PREPAGO_PARCIAL',
    "politicaSobrante" "SupplyPoliticaSobrante" NOT NULL DEFAULT 'EXPIRAR',
    "servicioId" TEXT,
    "promocionId" TEXT,
    "itemNombre" TEXT NOT NULL,
    "itemDescripcion" TEXT,
    "varianteEtiqueta" TEXT,
    "cantidad" INTEGER NOT NULL,
    "costoUnitario" DECIMAL(12,2) NOT NULL,
    "precioReferencia" DECIMAL(12,2),
    "aporteMembego" DECIMAL(12,2),
    "moneda" TEXT NOT NULL DEFAULT 'DOP',
    "anticipoPorcentaje" DECIMAL(5,2),
    "condicionesPago" TEXT,
    "inicioAt" TIMESTAMP(3) NOT NULL,
    "finAt" TIMESTAMP(3) NOT NULL,
    "sucursalIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "capacidadDiaria" INTEGER,
    "capacidadHoraria" INTEGER,
    "diasBloqueados" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "horarioTexto" TEXT,
    "reglasRedencion" TEXT,
    "reglasSustitucion" TEXT,
    "reglasCumplimiento" TEXT,
    "politicaCancelacion" TEXT,
    "notas" TEXT,
    "creadoPorId" TEXT,
    "aprobadoPorId" TEXT,
    "aprobadoAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "supply_acuerdos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_enmiendas" (
    "id" TEXT NOT NULL,
    "acuerdoId" TEXT NOT NULL,
    "campo" TEXT NOT NULL,
    "antes" JSONB NOT NULL DEFAULT '{}',
    "despues" JSONB NOT NULL DEFAULT '{}',
    "motivo" TEXT NOT NULL,
    "movimientoId" TEXT,
    "solicitadoPorId" TEXT,
    "aprobadoPorId" TEXT,
    "aprobadoAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "supply_enmiendas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_ordenes" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "acuerdoId" TEXT NOT NULL,
    "proveedorId" TEXT NOT NULL,
    "estado" "SupplyOrdenEstado" NOT NULL DEFAULT 'BORRADOR',
    "moneda" TEXT NOT NULL DEFAULT 'DOP',
    "subtotal" DECIMAL(14,2) NOT NULL,
    "impuestos" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "condicionesPago" TEXT,
    "notas" TEXT,
    "creadoPorId" TEXT,
    "aprobadoPorId" TEXT,
    "aprobadoAt" TIMESTAMP(3),
    "confirmadaAt" TIMESTAMP(3),
    "canceladaAt" TIMESTAMP(3),
    "canceladaMotivo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "supply_ordenes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_orden_lineas" (
    "id" TEXT NOT NULL,
    "ordenId" TEXT NOT NULL,
    "itemNombre" TEXT NOT NULL,
    "varianteEtiqueta" TEXT,
    "cantidad" INTEGER NOT NULL,
    "costoUnitario" DECIMAL(12,2) NOT NULL,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "supply_orden_lineas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_lotes" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "acuerdoId" TEXT NOT NULL,
    "ordenId" TEXT,
    "lineaId" TEXT,
    "proveedorId" TEXT NOT NULL,
    "estado" "SupplyLoteEstado" NOT NULL DEFAULT 'PROGRAMADO',
    "snapshotItemNombre" TEXT NOT NULL,
    "snapshotVariante" TEXT,
    "snapshotCostoUnitario" DECIMAL(12,2) NOT NULL,
    "snapshotPrecioReferencia" DECIMAL(12,2),
    "snapshotAporteMembego" DECIMAL(12,2),
    "snapshotModelo" "SupplyModeloComercial" NOT NULL,
    "snapshotTipo" "SupplyTipo" NOT NULL,
    "snapshotMoneda" TEXT NOT NULL DEFAULT 'DOP',
    "snapshotSucursalIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "snapshotCapacidadDiaria" INTEGER,
    "snapshotCapacidadHoraria" INTEGER,
    "inicioAt" TIMESTAMP(3) NOT NULL,
    "venceAt" TIMESTAMP(3) NOT NULL,
    "compradas" INTEGER NOT NULL DEFAULT 0,
    "disponibles" INTEGER NOT NULL DEFAULT 0,
    "asignadas" INTEGER NOT NULL DEFAULT 0,
    "retenidas" INTEGER NOT NULL DEFAULT 0,
    "emitidas" INTEGER NOT NULL DEFAULT 0,
    "redimidas" INTEGER NOT NULL DEFAULT 0,
    "cerradas" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "notas" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "supply_lotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_movimientos" (
    "id" TEXT NOT NULL,
    "loteId" TEXT NOT NULL,
    "tipo" "SupplyMovimientoTipo" NOT NULL,
    "origen" "SupplyCubeta",
    "destino" "SupplyCubeta",
    "cantidad" INTEGER NOT NULL,
    "asignacionId" TEXT,
    "derechoId" TEXT,
    "redencionId" TEXT,
    "referencia" TEXT,
    "motivo" TEXT,
    "actorId" TEXT,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "supply_movimientos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_asignaciones" (
    "id" TEXT NOT NULL,
    "loteId" TEXT NOT NULL,
    "destinoTipo" TEXT NOT NULL,
    "destinoId" TEXT,
    "etiqueta" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "emitidas" INTEGER NOT NULL DEFAULT 0,
    "liberadas" INTEGER NOT NULL DEFAULT 0,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "cerradaAt" TIMESTAMP(3),
    "creadoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "supply_asignaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_derechos" (
    "id" TEXT NOT NULL,
    "loteId" TEXT NOT NULL,
    "asignacionId" TEXT,
    "clienteId" TEXT NOT NULL,
    "proveedorId" TEXT NOT NULL,
    "estado" "SupplyDerechoEstado" NOT NULL DEFAULT 'ACTIVO',
    "origen" "SupplyOrigenDerecho" NOT NULL,
    "costoUnitario" DECIMAL(12,2) NOT NULL,
    "moneda" TEXT NOT NULL DEFAULT 'DOP',
    "precioCliente" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "vencAt" TIMESTAMP(3) NOT NULL,
    "emitidoAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redimidoAt" TIMESTAMP(3),
    "cerradoAt" TIMESTAMP(3),
    "cerradoMotivo" TEXT,
    "retencionExpiraAt" TIMESTAMP(3),
    "cubetaOrigen" "SupplyCubeta" NOT NULL DEFAULT 'DISPONIBLE',
    "claveIdempotencia" TEXT,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "supply_derechos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_vouchers" (
    "id" TEXT NOT NULL,
    "derechoId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "estado" "SupplyVoucherEstado" NOT NULL DEFAULT 'ACTIVO',
    "proveedorId" TEXT NOT NULL,
    "sucursalIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "vigenteDesde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vigenteHasta" TIMESTAMP(3) NOT NULL,
    "emitidoAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redimidoAt" TIMESTAMP(3),
    "cerradoAt" TIMESTAMP(3),
    "cerradoMotivo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "supply_vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_qr_sesiones" (
    "id" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "expiraAt" TIMESTAMP(3) NOT NULL,
    "sucursalId" TEXT,
    "consumidoAt" TIMESTAMP(3),
    "consumidoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "supply_qr_sesiones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_reservas" (
    "id" TEXT NOT NULL,
    "derechoId" TEXT NOT NULL,
    "proveedorId" TEXT NOT NULL,
    "sucursalId" TEXT NOT NULL,
    "dia" TEXT NOT NULL,
    "hora" INTEGER,
    "inicioAt" TIMESTAMP(3) NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'CONFIRMADA',
    "canceladaAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "supply_reservas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_redenciones" (
    "id" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "derechoId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "proveedorId" TEXT NOT NULL,
    "sucursalId" TEXT,
    "loteId" TEXT NOT NULL,
    "acuerdoId" TEXT NOT NULL,
    "asignacionId" TEXT,
    "destinoTipo" TEXT,
    "destinoId" TEXT,
    "empleadoId" TEXT,
    "costoUnitario" DECIMAL(12,2) NOT NULL,
    "moneda" TEXT NOT NULL DEFAULT 'DOP',
    "extrasMonto" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "extrasNota" TEXT,
    "aporteClienteComercio" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "canal" TEXT NOT NULL DEFAULT 'SCANNER',
    "reversadaAt" TIMESTAMP(3),
    "reversadaPorId" TEXT,
    "reversadaMotivo" TEXT,
    "claveIdempotencia" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "supply_redenciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_incidencias" (
    "id" TEXT NOT NULL,
    "proveedorId" TEXT NOT NULL,
    "clienteId" TEXT,
    "redencionId" TEXT,
    "voucherId" TEXT,
    "derechoId" TEXT,
    "loteId" TEXT,
    "acuerdoId" TEXT,
    "sucursalId" TEXT,
    "destinoTipo" TEXT,
    "destinoId" TEXT,
    "tipo" "SupplyIncidenciaTipo" NOT NULL,
    "estado" "SupplyIncidenciaEstado" NOT NULL DEFAULT 'ABIERTA',
    "detalle" TEXT NOT NULL,
    "resolucion" TEXT,
    "reportadoPorId" TEXT,
    "resueltoPorId" TEXT,
    "resueltoAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "supply_incidencias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_pagos" (
    "id" TEXT NOT NULL,
    "acuerdoId" TEXT NOT NULL,
    "ordenId" TEXT,
    "proveedorId" TEXT NOT NULL,
    "tipo" "SupplyPagoTipo" NOT NULL,
    "monto" DECIMAL(14,2) NOT NULL,
    "moneda" TEXT NOT NULL DEFAULT 'DOP',
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "metodo" TEXT,
    "referencia" TEXT,
    "notas" TEXT,
    "periodoDesde" TIMESTAMP(3),
    "periodoHasta" TIMESTAMP(3),
    "registradoPorId" TEXT,
    "confirmadoAt" TIMESTAMP(3),
    "claveIdempotencia" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "supply_pagos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_asientos_financieros" (
    "id" TEXT NOT NULL,
    "proveedorId" TEXT NOT NULL,
    "acuerdoId" TEXT,
    "ordenId" TEXT,
    "pagoId" TEXT,
    "tipo" "SupplyAsientoTipo" NOT NULL,
    "monto" DECIMAL(14,2) NOT NULL,
    "moneda" TEXT NOT NULL DEFAULT 'DOP',
    "redencionId" TEXT,
    "referencia" TEXT,
    "motivo" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "supply_asientos_financieros_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_acuerdos_codigo_key" ON "supply_acuerdos"("codigo");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_acuerdos_proveedorId_estado_idx" ON "supply_acuerdos"("proveedorId", "estado");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_acuerdos_estado_finAt_idx" ON "supply_acuerdos"("estado", "finAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_acuerdos_servicioId_idx" ON "supply_acuerdos"("servicioId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_acuerdos_promocionId_idx" ON "supply_acuerdos"("promocionId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_enmiendas_movimientoId_key" ON "supply_enmiendas"("movimientoId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_enmiendas_acuerdoId_createdAt_idx" ON "supply_enmiendas"("acuerdoId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_ordenes_numero_key" ON "supply_ordenes"("numero");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_ordenes_proveedorId_estado_idx" ON "supply_ordenes"("proveedorId", "estado");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_ordenes_acuerdoId_idx" ON "supply_ordenes"("acuerdoId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_ordenes_estado_createdAt_idx" ON "supply_ordenes"("estado", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_orden_lineas_ordenId_idx" ON "supply_orden_lineas"("ordenId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_lotes_codigo_key" ON "supply_lotes"("codigo");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_lotes_proveedorId_estado_idx" ON "supply_lotes"("proveedorId", "estado");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_lotes_estado_venceAt_idx" ON "supply_lotes"("estado", "venceAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_lotes_acuerdoId_idx" ON "supply_lotes"("acuerdoId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_lotes_ordenId_idx" ON "supply_lotes"("ordenId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_movimientos_loteId_createdAt_idx" ON "supply_movimientos"("loteId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_movimientos_loteId_tipo_idx" ON "supply_movimientos"("loteId", "tipo");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_movimientos_asignacionId_idx" ON "supply_movimientos"("asignacionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_movimientos_derechoId_idx" ON "supply_movimientos"("derechoId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_movimientos_redencionId_idx" ON "supply_movimientos"("redencionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_movimientos_referencia_idx" ON "supply_movimientos"("referencia");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_asignaciones_loteId_activa_idx" ON "supply_asignaciones"("loteId", "activa");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_asignaciones_destinoTipo_destinoId_idx" ON "supply_asignaciones"("destinoTipo", "destinoId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_derechos_claveIdempotencia_key" ON "supply_derechos"("claveIdempotencia");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_derechos_clienteId_estado_idx" ON "supply_derechos"("clienteId", "estado");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_derechos_loteId_estado_idx" ON "supply_derechos"("loteId", "estado");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_derechos_proveedorId_estado_idx" ON "supply_derechos"("proveedorId", "estado");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_derechos_asignacionId_idx" ON "supply_derechos"("asignacionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_derechos_estado_vencAt_idx" ON "supply_derechos"("estado", "vencAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_derechos_estado_retencionExpiraAt_idx" ON "supply_derechos"("estado", "retencionExpiraAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_vouchers_codigo_key" ON "supply_vouchers"("codigo");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_vouchers_derechoId_idx" ON "supply_vouchers"("derechoId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_vouchers_proveedorId_estado_idx" ON "supply_vouchers"("proveedorId", "estado");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_vouchers_estado_vigenteHasta_idx" ON "supply_vouchers"("estado", "vigenteHasta");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_qr_sesiones_nonce_key" ON "supply_qr_sesiones"("nonce");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_qr_sesiones_voucherId_createdAt_idx" ON "supply_qr_sesiones"("voucherId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_qr_sesiones_expiraAt_idx" ON "supply_qr_sesiones"("expiraAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_reservas_proveedorId_dia_hora_idx" ON "supply_reservas"("proveedorId", "dia", "hora");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_reservas_derechoId_idx" ON "supply_reservas"("derechoId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_reservas_sucursalId_dia_idx" ON "supply_reservas"("sucursalId", "dia");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_redenciones_claveIdempotencia_key" ON "supply_redenciones"("claveIdempotencia");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_redenciones_proveedorId_createdAt_idx" ON "supply_redenciones"("proveedorId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_redenciones_loteId_createdAt_idx" ON "supply_redenciones"("loteId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_redenciones_clienteId_createdAt_idx" ON "supply_redenciones"("clienteId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_redenciones_sucursalId_createdAt_idx" ON "supply_redenciones"("sucursalId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_redenciones_acuerdoId_createdAt_idx" ON "supply_redenciones"("acuerdoId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_redenciones_destinoTipo_destinoId_idx" ON "supply_redenciones"("destinoTipo", "destinoId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_incidencias_proveedorId_estado_idx" ON "supply_incidencias"("proveedorId", "estado");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_incidencias_estado_createdAt_idx" ON "supply_incidencias"("estado", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_incidencias_loteId_idx" ON "supply_incidencias"("loteId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_incidencias_redencionId_idx" ON "supply_incidencias"("redencionId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_pagos_claveIdempotencia_key" ON "supply_pagos"("claveIdempotencia");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_pagos_proveedorId_estado_idx" ON "supply_pagos"("proveedorId", "estado");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_pagos_acuerdoId_createdAt_idx" ON "supply_pagos"("acuerdoId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_asientos_financieros_proveedorId_createdAt_idx" ON "supply_asientos_financieros"("proveedorId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_asientos_financieros_acuerdoId_tipo_idx" ON "supply_asientos_financieros"("acuerdoId", "tipo");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_asientos_financieros_pagoId_idx" ON "supply_asientos_financieros"("pagoId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_asientos_financieros_redencionId_idx" ON "supply_asientos_financieros"("redencionId");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_acuerdos" ADD CONSTRAINT "supply_acuerdos_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_acuerdos" ADD CONSTRAINT "supply_acuerdos_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "servicios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_acuerdos" ADD CONSTRAINT "supply_acuerdos_promocionId_fkey" FOREIGN KEY ("promocionId") REFERENCES "promociones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_acuerdos" ADD CONSTRAINT "supply_acuerdos_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_acuerdos" ADD CONSTRAINT "supply_acuerdos_aprobadoPorId_fkey" FOREIGN KEY ("aprobadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_enmiendas" ADD CONSTRAINT "supply_enmiendas_acuerdoId_fkey" FOREIGN KEY ("acuerdoId") REFERENCES "supply_acuerdos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_enmiendas" ADD CONSTRAINT "supply_enmiendas_solicitadoPorId_fkey" FOREIGN KEY ("solicitadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_enmiendas" ADD CONSTRAINT "supply_enmiendas_aprobadoPorId_fkey" FOREIGN KEY ("aprobadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_ordenes" ADD CONSTRAINT "supply_ordenes_acuerdoId_fkey" FOREIGN KEY ("acuerdoId") REFERENCES "supply_acuerdos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_ordenes" ADD CONSTRAINT "supply_ordenes_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_ordenes" ADD CONSTRAINT "supply_ordenes_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_ordenes" ADD CONSTRAINT "supply_ordenes_aprobadoPorId_fkey" FOREIGN KEY ("aprobadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_orden_lineas" ADD CONSTRAINT "supply_orden_lineas_ordenId_fkey" FOREIGN KEY ("ordenId") REFERENCES "supply_ordenes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_lotes" ADD CONSTRAINT "supply_lotes_acuerdoId_fkey" FOREIGN KEY ("acuerdoId") REFERENCES "supply_acuerdos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_lotes" ADD CONSTRAINT "supply_lotes_ordenId_fkey" FOREIGN KEY ("ordenId") REFERENCES "supply_ordenes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_lotes" ADD CONSTRAINT "supply_lotes_lineaId_fkey" FOREIGN KEY ("lineaId") REFERENCES "supply_orden_lineas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_lotes" ADD CONSTRAINT "supply_lotes_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_movimientos" ADD CONSTRAINT "supply_movimientos_loteId_fkey" FOREIGN KEY ("loteId") REFERENCES "supply_lotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_movimientos" ADD CONSTRAINT "supply_movimientos_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_asignaciones" ADD CONSTRAINT "supply_asignaciones_loteId_fkey" FOREIGN KEY ("loteId") REFERENCES "supply_lotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_asignaciones" ADD CONSTRAINT "supply_asignaciones_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_derechos" ADD CONSTRAINT "supply_derechos_loteId_fkey" FOREIGN KEY ("loteId") REFERENCES "supply_lotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_derechos" ADD CONSTRAINT "supply_derechos_asignacionId_fkey" FOREIGN KEY ("asignacionId") REFERENCES "supply_asignaciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_derechos" ADD CONSTRAINT "supply_derechos_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_derechos" ADD CONSTRAINT "supply_derechos_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_vouchers" ADD CONSTRAINT "supply_vouchers_derechoId_fkey" FOREIGN KEY ("derechoId") REFERENCES "supply_derechos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_vouchers" ADD CONSTRAINT "supply_vouchers_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_qr_sesiones" ADD CONSTRAINT "supply_qr_sesiones_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "supply_vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_qr_sesiones" ADD CONSTRAINT "supply_qr_sesiones_consumidoPorId_fkey" FOREIGN KEY ("consumidoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_reservas" ADD CONSTRAINT "supply_reservas_derechoId_fkey" FOREIGN KEY ("derechoId") REFERENCES "supply_derechos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_reservas" ADD CONSTRAINT "supply_reservas_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_reservas" ADD CONSTRAINT "supply_reservas_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "sucursales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_redenciones" ADD CONSTRAINT "supply_redenciones_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "supply_vouchers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_redenciones" ADD CONSTRAINT "supply_redenciones_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_redenciones" ADD CONSTRAINT "supply_redenciones_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_redenciones" ADD CONSTRAINT "supply_redenciones_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "sucursales"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_redenciones" ADD CONSTRAINT "supply_redenciones_empleadoId_fkey" FOREIGN KEY ("empleadoId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_redenciones" ADD CONSTRAINT "supply_redenciones_reversadaPorId_fkey" FOREIGN KEY ("reversadaPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_incidencias" ADD CONSTRAINT "supply_incidencias_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_incidencias" ADD CONSTRAINT "supply_incidencias_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_incidencias" ADD CONSTRAINT "supply_incidencias_redencionId_fkey" FOREIGN KEY ("redencionId") REFERENCES "supply_redenciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_incidencias" ADD CONSTRAINT "supply_incidencias_reportadoPorId_fkey" FOREIGN KEY ("reportadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_incidencias" ADD CONSTRAINT "supply_incidencias_resueltoPorId_fkey" FOREIGN KEY ("resueltoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_pagos" ADD CONSTRAINT "supply_pagos_acuerdoId_fkey" FOREIGN KEY ("acuerdoId") REFERENCES "supply_acuerdos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_pagos" ADD CONSTRAINT "supply_pagos_ordenId_fkey" FOREIGN KEY ("ordenId") REFERENCES "supply_ordenes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_pagos" ADD CONSTRAINT "supply_pagos_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_pagos" ADD CONSTRAINT "supply_pagos_registradoPorId_fkey" FOREIGN KEY ("registradoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_asientos_financieros" ADD CONSTRAINT "supply_asientos_financieros_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_asientos_financieros" ADD CONSTRAINT "supply_asientos_financieros_acuerdoId_fkey" FOREIGN KEY ("acuerdoId") REFERENCES "supply_acuerdos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_asientos_financieros" ADD CONSTRAINT "supply_asientos_financieros_ordenId_fkey" FOREIGN KEY ("ordenId") REFERENCES "supply_ordenes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_asientos_financieros" ADD CONSTRAINT "supply_asientos_financieros_pagoId_fkey" FOREIGN KEY ("pagoId") REFERENCES "supply_pagos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_asientos_financieros" ADD CONSTRAINT "supply_asientos_financieros_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- INVARIANTES A NIVEL DE BASE  (Fase 45 · "integridad financiera primero")
-- ============================================================================

-- ── El lote no puede tener cubetas negativas ni descuadrar ──────────────────
--
-- La segunda condición es EL invariante del dominio:
--   comprado = disponible + asignado + retenido + emitido + redimido + cerrado
-- Escrito aquí, ninguna ruta de código —ni una futura, ni un script manual de
-- madrugada— puede dejar un lote en un estado que no cuadre.
DO $$ BEGIN
    ALTER TABLE "supply_lotes" ADD CONSTRAINT "supply_lotes_cubetas_no_negativas"
      CHECK ("compradas" >= 0 AND "disponibles" >= 0 AND "asignadas" >= 0
         AND "retenidas" >= 0 AND "emitidas" >= 0 AND "redimidas" >= 0
         AND "cerradas" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_lotes" ADD CONSTRAINT "supply_lotes_cuadre_cubetas"
      CHECK ("compradas" = "disponibles" + "asignadas" + "retenidas"
                         + "emitidas" + "redimidas" + "cerradas");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Un asiento del ledger mueve una cantidad POSITIVA ───────────────────────
--
-- El signo lo da el par (origen, destino). Permitir negativos haría que dos
-- asientos distintos pudieran significar lo mismo y que el invariante
-- dependiera de quién lo escribió.
DO $$ BEGIN
    ALTER TABLE "supply_movimientos" ADD CONSTRAINT "supply_movimientos_cantidad_positiva"
      CHECK ("cantidad" > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Un asiento que no entra ni sale de ninguna cubeta no es un asiento.
DO $$ BEGIN
    ALTER TABLE "supply_movimientos" ADD CONSTRAINT "supply_movimientos_traslado_real"
      CHECK ("origen" IS NOT NULL OR "destino" IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Una campaña no puede emitir más de lo que se le asignó ──────────────────
DO $$ BEGIN
    ALTER TABLE "supply_asignaciones" ADD CONSTRAINT "supply_asignaciones_sin_sobregiro"
      CHECK ("cantidad" > 0 AND "emitidas" >= 0 AND "liberadas" >= 0
         AND "emitidas" + "liberadas" <= "cantidad");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Nada se compra ni se vende en cantidades absurdas ───────────────────────
DO $$ BEGIN
    ALTER TABLE "supply_acuerdos" ADD CONSTRAINT "supply_acuerdos_montos_validos"
      CHECK ("cantidad" > 0 AND "costoUnitario" >= 0 AND "inicioAt" < "finAt");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_orden_lineas" ADD CONSTRAINT "supply_orden_lineas_cantidad_positiva"
      CHECK ("cantidad" > 0 AND "costoUnitario" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Un derecho tiene como mucho UNA reserva viva ────────────────────────────
--
-- Índice PARCIAL: reprogramar cancela la anterior y crea otra, así que el
-- histórico de reservas canceladas convive sin chocar. Sin el `WHERE`, la
-- segunda reserva de un cliente que cambió de hora sería imposible.
CREATE UNIQUE INDEX IF NOT EXISTS "supply_reservas_derecho_viva"
  ON "supply_reservas" ("derechoId") WHERE "estado" = 'CONFIRMADA';

-- ── Un derecho activo tiene como mucho UN voucher activo ────────────────────
--
-- Reemitir un voucher exige cerrar el anterior. Si no, un derecho con dos
-- códigos vivos se canjea dos veces contra la misma unidad: el escáner valida
-- el voucher que le enseñan y ambos apuntan al mismo derecho.
CREATE UNIQUE INDEX IF NOT EXISTS "supply_vouchers_derecho_activo"
  ON "supply_vouchers" ("derechoId") WHERE "estado" = 'ACTIVO';

-- ── Una redención viva por voucher ──────────────────────────────────────────
--
-- La red bajo la idempotencia: aunque dos peticiones simultáneas pasaran la
-- comprobación de estado, solo una consigue insertar. La reversada no cuenta,
-- porque revertir y volver a entregar es un caso legítimo.
CREATE UNIQUE INDEX IF NOT EXISTS "supply_redenciones_voucher_viva"
  ON "supply_redenciones" ("voucherId") WHERE "reversadaAt" IS NULL;

-- ── Rendimiento (Fase 46) ───────────────────────────────────────────────────
--
-- Los cuatro recorridos caros del módulo, que ningún índice de Prisma cubre
-- porque mezclan columnas de filtro con las de orden:
--   · "qué vence pronto y cuánto dinero hay ahí"  (lotes activos por fecha)
--   · "qué holds hay que soltar"                  (barrido del cron)
--   · "redenciones de este proveedor este mes"    (liquidación)
--   · "cuántas unidades ya se entregaron hoy"     (capacidad diaria/horaria)
CREATE INDEX IF NOT EXISTS "supply_lotes_vencimiento_activo"
  ON "supply_lotes" ("venceAt") WHERE "estado" = 'ACTIVO';

CREATE INDEX IF NOT EXISTS "supply_derechos_holds_vencidos"
  ON "supply_derechos" ("retencionExpiraAt") WHERE "estado" = 'RETENIDO';

CREATE INDEX IF NOT EXISTS "supply_redenciones_liquidacion"
  ON "supply_redenciones" ("proveedorId", "acuerdoId", "createdAt")
  WHERE "reversadaAt" IS NULL;

CREATE INDEX IF NOT EXISTS "supply_reservas_capacidad"
  ON "supply_reservas" ("proveedorId", "dia", "hora") WHERE "estado" = 'CONFIRMADA';

-- ============================================================================
-- ACCIONES DE BITÁCORA DEL MÓDULO  (Fase 43)
-- ============================================================================
--
-- `ADD VALUE IF NOT EXISTS` sobre un enum vivo: no reescribe la tabla, no
-- bloquea `audit_logs` y aplicarlo dos veces no falla. Va FUERA de cualquier
-- bloque DO porque Postgres no permite ALTER TYPE ... ADD VALUE dentro de una
-- transacción que después use el valor nuevo.

ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_ACUERDO_CREADO';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_ACUERDO_ESTADO';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_ENMIENDA_REGISTRADA';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_ORDEN_CREADA';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_ORDEN_ESTADO';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_LOTE_ACTIVADO';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_ASIGNACION_CREADA';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_ASIGNACION_LIBERADA';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_DERECHO_EMITIDO';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_DERECHO_CANCELADO';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_VOUCHER_EMITIDO';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_REDENCION_REGISTRADA';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_REDENCION_REVERSADA';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_INCIDENCIA_ABIERTA';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_INCIDENCIA_RESUELTA';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_PAGO_REGISTRADO';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_PAGO_CONFIRMADO';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_AJUSTE_LEDGER';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_LOTE_RECALCULADO';
