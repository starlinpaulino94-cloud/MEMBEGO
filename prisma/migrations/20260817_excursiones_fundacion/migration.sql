-- ============================================================================
-- EXCURSIONES · Fase 1 — FUNDACIÓN (17-08-2026). Idempotente.
-- Crea las 19 tablas del módulo (catálogo, vendedores/atribución, reservas/
-- pagos/ventas, motor de comisiones/liquidaciones, configuración) y siembra
-- el vertical EXCURSIONES. Los estados son TEXT (dominios documentados en
-- prisma/schema/excursiones.prisma). Ids del núcleo (companyId, clienteId,
-- userId…) van PLANOS: el aislamiento lo garantizan conEmpresa/RLS y las
-- acciones — mismo precedente que solicitudes_empresa.
-- ============================================================================

-- ── Catálogo ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "excursiones" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL,
  "nombre" TEXT NOT NULL, "slug" TEXT NOT NULL, "codigo" TEXT,
  "descripcion" TEXT, "portadaUrl" TEXT, "galeria" JSONB,
  "duracionMin" INTEGER, "ubicacion" TEXT, "categoria" TEXT,
  "moneda" TEXT NOT NULL DEFAULT 'DOP', "impuestoPct" DECIMAL(5,2),
  "capacidad" INTEGER, "puntoSalida" TEXT, "horaSalida" TEXT, "horaRegreso" TEXT,
  "politicas" TEXT, "incluye" TEXT, "noIncluye" TEXT,
  "estado" TEXT NOT NULL DEFAULT 'ACTIVA', "providerId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "excursiones_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "excursiones_companyId_slug_key" ON "excursiones"("companyId","slug");
CREATE INDEX IF NOT EXISTS "excursiones_companyId_estado_idx" ON "excursiones"("companyId","estado");

CREATE TABLE IF NOT EXISTS "excursion_variantes" (
  "id" TEXT NOT NULL, "excursionId" TEXT NOT NULL, "companyId" TEXT NOT NULL,
  "nombre" TEXT NOT NULL,
  "precioAdulto" DECIMAL(12,2) NOT NULL, "precioNino" DECIMAL(12,2),
  "precioResidente" DECIMAL(12,2), "precioTurista" DECIMAL(12,2),
  "capacidad" INTEGER, "activa" BOOLEAN NOT NULL DEFAULT true,
  "orden" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "excursion_variantes_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  ALTER TABLE "excursion_variantes" ADD CONSTRAINT "excursion_variantes_excursionId_fkey"
    FOREIGN KEY ("excursionId") REFERENCES "excursiones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "excursion_variantes_excursionId_activa_idx" ON "excursion_variantes"("excursionId","activa");

CREATE TABLE IF NOT EXISTS "excursion_horarios" (
  "id" TEXT NOT NULL, "excursionId" TEXT NOT NULL, "companyId" TEXT NOT NULL,
  "diasSemana" JSONB NOT NULL, "horaSalida" TEXT NOT NULL,
  "cupo" INTEGER, "activo" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "excursion_horarios_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  ALTER TABLE "excursion_horarios" ADD CONSTRAINT "excursion_horarios_excursionId_fkey"
    FOREIGN KEY ("excursionId") REFERENCES "excursiones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "excursion_horarios_excursionId_activo_idx" ON "excursion_horarios"("excursionId","activo");

-- ── Vendedores y atribución ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "vendedores" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "userId" TEXT,
  "nombre" TEXT NOT NULL, "apellido" TEXT, "fotoUrl" TEXT,
  "telefono" TEXT, "whatsapp" TEXT, "email" TEXT, "documento" TEXT, "direccion" TEXT,
  "codigo" TEXT NOT NULL, "tipo" TEXT, "sucursalId" TEXT, "supervisorId" TEXT,
  "fechaIngreso" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "estado" TEXT NOT NULL DEFAULT 'ACTIVO',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vendedores_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  ALTER TABLE "vendedores" ADD CONSTRAINT "vendedores_supervisorId_fkey"
    FOREIGN KEY ("supervisorId") REFERENCES "vendedores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "vendedores_companyId_codigo_key" ON "vendedores"("companyId","codigo");
CREATE INDEX IF NOT EXISTS "vendedores_companyId_estado_idx" ON "vendedores"("companyId","estado");
CREATE INDEX IF NOT EXISTS "vendedores_userId_idx" ON "vendedores"("userId");
CREATE INDEX IF NOT EXISTS "vendedores_supervisorId_idx" ON "vendedores"("supervisorId");

CREATE TABLE IF NOT EXISTS "vendedor_enlaces" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "vendedorId" TEXT NOT NULL,
  "slug" TEXT NOT NULL, "campanaId" TEXT, "activo" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vendedor_enlaces_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  ALTER TABLE "vendedor_enlaces" ADD CONSTRAINT "vendedor_enlaces_vendedorId_fkey"
    FOREIGN KEY ("vendedorId") REFERENCES "vendedores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "vendedor_enlaces_slug_key" ON "vendedor_enlaces"("slug");
CREATE INDEX IF NOT EXISTS "vendedor_enlaces_vendedorId_activo_idx" ON "vendedor_enlaces"("vendedorId","activo");

CREATE TABLE IF NOT EXISTS "vendedor_atribuciones" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "vendedorId" TEXT NOT NULL,
  "clienteId" TEXT, "visitorId" TEXT,
  "etapa" TEXT NOT NULL, "canal" TEXT, "enlaceSlug" TEXT,
  "campanaId" TEXT, "landing" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vendedor_atribuciones_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  ALTER TABLE "vendedor_atribuciones" ADD CONSTRAINT "vendedor_atribuciones_vendedorId_fkey"
    FOREIGN KEY ("vendedorId") REFERENCES "vendedores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "vendedor_atribuciones_embudo_idx" ON "vendedor_atribuciones"("companyId","vendedorId","etapa","createdAt");
CREATE INDEX IF NOT EXISTS "vendedor_atribuciones_clienteId_idx" ON "vendedor_atribuciones"("clienteId");
CREATE INDEX IF NOT EXISTS "vendedor_atribuciones_visitorId_idx" ON "vendedor_atribuciones"("visitorId");

CREATE TABLE IF NOT EXISTS "vendedor_metas" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "vendedorId" TEXT NOT NULL,
  "periodo" TEXT NOT NULL, "desde" TIMESTAMP(3), "hasta" TIMESTAMP(3),
  "metaVentas" INTEGER, "metaPasajeros" INTEGER, "metaIngresos" DECIMAL(12,2),
  "metaRegistros" INTEGER, "metaReservas" INTEGER,
  "activa" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vendedor_metas_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  ALTER TABLE "vendedor_metas" ADD CONSTRAINT "vendedor_metas_vendedorId_fkey"
    FOREIGN KEY ("vendedorId") REFERENCES "vendedores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "vendedor_metas_vendedorId_activa_idx" ON "vendedor_metas"("vendedorId","activa");

CREATE TABLE IF NOT EXISTS "vendedor_bonos" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "vendedorId" TEXT NOT NULL,
  "descripcion" TEXT NOT NULL, "condicion" JSONB,
  "monto" DECIMAL(12,2) NOT NULL, "moneda" TEXT NOT NULL DEFAULT 'DOP',
  "estado" TEXT NOT NULL DEFAULT 'PENDIENTE', "liquidacionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vendedor_bonos_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  ALTER TABLE "vendedor_bonos" ADD CONSTRAINT "vendedor_bonos_vendedorId_fkey"
    FOREIGN KEY ("vendedorId") REFERENCES "vendedores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "vendedor_bonos_companyId_vendedorId_estado_idx" ON "vendedor_bonos"("companyId","vendedorId","estado");

CREATE TABLE IF NOT EXISTS "vendedor_tipos" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "nombre" TEXT NOT NULL,
  "activo" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "vendedor_tipos_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "vendedor_tipos_companyId_nombre_key" ON "vendedor_tipos"("companyId","nombre");

CREATE TABLE IF NOT EXISTS "canales_venta" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "nombre" TEXT NOT NULL,
  "activo" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "canales_venta_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "canales_venta_companyId_nombre_key" ON "canales_venta"("companyId","nombre");

-- ── Reservas, pagos y ventas ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "reservas_excursion" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "numero" TEXT NOT NULL,
  "clienteId" TEXT NOT NULL, "vendedorId" TEXT, "excursionId" TEXT NOT NULL,
  "varianteId" TEXT, "sucursalId" TEXT,
  "fecha" TIMESTAMP(3) NOT NULL, "hora" TEXT,
  "adultos" INTEGER NOT NULL DEFAULT 0, "ninos" INTEGER NOT NULL DEFAULT 0,
  "subtotal" DECIMAL(12,2) NOT NULL, "descuento" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "impuestos" DECIMAL(12,2) NOT NULL DEFAULT 0, "total" DECIMAL(12,2) NOT NULL,
  "moneda" TEXT NOT NULL DEFAULT 'DOP', "tasaCambio" DECIMAL(12,6),
  "estado" TEXT NOT NULL DEFAULT 'PENDIENTE', "canal" TEXT, "notas" TEXT,
  "creadaPorId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reservas_excursion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "reservas_excursion_companyId_numero_key" ON "reservas_excursion"("companyId","numero");
CREATE INDEX IF NOT EXISTS "reservas_excursion_companyId_estado_fecha_idx" ON "reservas_excursion"("companyId","estado","fecha");
CREATE INDEX IF NOT EXISTS "reservas_excursion_companyId_vendedorId_createdAt_idx" ON "reservas_excursion"("companyId","vendedorId","createdAt");
CREATE INDEX IF NOT EXISTS "reservas_excursion_clienteId_idx" ON "reservas_excursion"("clienteId");
CREATE INDEX IF NOT EXISTS "reservas_excursion_excursionId_idx" ON "reservas_excursion"("excursionId");

CREATE TABLE IF NOT EXISTS "reserva_pasajeros" (
  "id" TEXT NOT NULL, "reservaId" TEXT NOT NULL, "companyId" TEXT NOT NULL,
  "tipo" TEXT NOT NULL, "nombre" TEXT,
  CONSTRAINT "reserva_pasajeros_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  ALTER TABLE "reserva_pasajeros" ADD CONSTRAINT "reserva_pasajeros_reservaId_fkey"
    FOREIGN KEY ("reservaId") REFERENCES "reservas_excursion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "reserva_pasajeros_reservaId_idx" ON "reserva_pasajeros"("reservaId");

CREATE TABLE IF NOT EXISTS "reserva_pagos" (
  "id" TEXT NOT NULL, "reservaId" TEXT NOT NULL, "companyId" TEXT NOT NULL,
  "monto" DECIMAL(12,2) NOT NULL, "moneda" TEXT NOT NULL DEFAULT 'DOP',
  "metodo" TEXT NOT NULL, "referencia" TEXT, "comprobanteUrl" TEXT,
  "estado" TEXT NOT NULL DEFAULT 'REGISTRADO',
  "confirmadoPorId" TEXT, "notas" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reserva_pagos_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  ALTER TABLE "reserva_pagos" ADD CONSTRAINT "reserva_pagos_reservaId_fkey"
    FOREIGN KEY ("reservaId") REFERENCES "reservas_excursion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "reserva_pagos_reservaId_estado_idx" ON "reserva_pagos"("reservaId","estado");
CREATE INDEX IF NOT EXISTS "reserva_pagos_companyId_createdAt_idx" ON "reserva_pagos"("companyId","createdAt");

CREATE TABLE IF NOT EXISTS "ventas_excursion" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "numero" TEXT NOT NULL,
  "reservaId" TEXT NOT NULL, "clienteId" TEXT NOT NULL, "vendedorId" TEXT,
  "excursionId" TEXT NOT NULL, "pasajeros" INTEGER NOT NULL,
  "total" DECIMAL(12,2) NOT NULL, "moneda" TEXT NOT NULL DEFAULT 'DOP',
  "estado" TEXT NOT NULL DEFAULT 'PENDIENTE', "transactionId" TEXT,
  "confirmadaAt" TIMESTAMP(3), "canceladaAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ventas_excursion_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  ALTER TABLE "ventas_excursion" ADD CONSTRAINT "ventas_excursion_reservaId_fkey"
    FOREIGN KEY ("reservaId") REFERENCES "reservas_excursion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "ventas_excursion_reservaId_key" ON "ventas_excursion"("reservaId");
CREATE UNIQUE INDEX IF NOT EXISTS "ventas_excursion_companyId_numero_key" ON "ventas_excursion"("companyId","numero");
CREATE INDEX IF NOT EXISTS "ventas_excursion_companyId_estado_createdAt_idx" ON "ventas_excursion"("companyId","estado","createdAt");
CREATE INDEX IF NOT EXISTS "ventas_excursion_companyId_vendedorId_createdAt_idx" ON "ventas_excursion"("companyId","vendedorId","createdAt");
CREATE INDEX IF NOT EXISTS "ventas_excursion_clienteId_idx" ON "ventas_excursion"("clienteId");

CREATE TABLE IF NOT EXISTS "reembolsos_excursion" (
  "id" TEXT NOT NULL, "ventaId" TEXT NOT NULL, "companyId" TEXT NOT NULL,
  "monto" DECIMAL(12,2) NOT NULL, "motivo" TEXT, "responsableId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reembolsos_excursion_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  ALTER TABLE "reembolsos_excursion" ADD CONSTRAINT "reembolsos_excursion_ventaId_fkey"
    FOREIGN KEY ("ventaId") REFERENCES "ventas_excursion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "reembolsos_excursion_ventaId_idx" ON "reembolsos_excursion"("ventaId");

-- ── Comisiones y liquidaciones ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "comision_reglas" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL,
  "ambito" TEXT NOT NULL, "excursionId" TEXT, "vendedorId" TEXT, "categoria" TEXT,
  "tipoCalculo" TEXT NOT NULL, "valor" DECIMAL(12,2) NOT NULL, "escalones" JSONB,
  "activa" BOOLEAN NOT NULL DEFAULT true,
  "vigenciaDesde" TIMESTAMP(3), "vigenciaHasta" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "comision_reglas_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "comision_reglas_companyId_activa_ambito_idx" ON "comision_reglas"("companyId","activa","ambito");

CREATE TABLE IF NOT EXISTS "liquidaciones" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "numero" TEXT NOT NULL,
  "vendedorId" TEXT NOT NULL,
  "periodoDesde" TIMESTAMP(3) NOT NULL, "periodoHasta" TIMESTAMP(3) NOT NULL,
  "total" DECIMAL(12,2) NOT NULL, "moneda" TEXT NOT NULL DEFAULT 'DOP',
  "estado" TEXT NOT NULL DEFAULT 'BORRADOR',
  "metodo" TEXT, "referencia" TEXT, "comprobanteUrl" TEXT, "notas" TEXT,
  "pagadaPorId" TEXT, "pagadaAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "liquidaciones_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "liquidaciones_companyId_numero_key" ON "liquidaciones"("companyId","numero");
CREATE INDEX IF NOT EXISTS "liquidaciones_companyId_vendedorId_estado_idx" ON "liquidaciones"("companyId","vendedorId","estado");

CREATE TABLE IF NOT EXISTS "comision_entradas" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "ventaId" TEXT NOT NULL,
  "vendedorId" TEXT NOT NULL,
  "base" DECIMAL(12,2) NOT NULL, "monto" DECIMAL(12,2) NOT NULL,
  "moneda" TEXT NOT NULL DEFAULT 'DOP',
  "reglaSnapshot" JSONB NOT NULL, "desglose" TEXT NOT NULL,
  "estado" TEXT NOT NULL DEFAULT 'GENERADA', "liquidacionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "comision_entradas_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  ALTER TABLE "comision_entradas" ADD CONSTRAINT "comision_entradas_ventaId_fkey"
    FOREIGN KEY ("ventaId") REFERENCES "ventas_excursion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "comision_entradas" ADD CONSTRAINT "comision_entradas_liquidacionId_fkey"
    FOREIGN KEY ("liquidacionId") REFERENCES "liquidaciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "comision_entradas_companyId_vendedorId_estado_createdAt_idx" ON "comision_entradas"("companyId","vendedorId","estado","createdAt");
CREATE INDEX IF NOT EXISTS "comision_entradas_ventaId_idx" ON "comision_entradas"("ventaId");
CREATE INDEX IF NOT EXISTS "comision_entradas_liquidacionId_idx" ON "comision_entradas"("liquidacionId");

CREATE TABLE IF NOT EXISTS "comision_ajustes" (
  "id" TEXT NOT NULL, "comisionId" TEXT NOT NULL, "companyId" TEXT NOT NULL,
  "monto" DECIMAL(12,2) NOT NULL, "motivo" TEXT NOT NULL,
  "responsableId" TEXT, "liquidacionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "comision_ajustes_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  ALTER TABLE "comision_ajustes" ADD CONSTRAINT "comision_ajustes_comisionId_fkey"
    FOREIGN KEY ("comisionId") REFERENCES "comision_entradas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "comision_ajustes_comisionId_idx" ON "comision_ajustes"("comisionId");
CREATE INDEX IF NOT EXISTS "comision_ajustes_companyId_liquidacionId_idx" ON "comision_ajustes"("companyId","liquidacionId");

-- ── Configuración ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "excursiones_config" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL,
  "politicaAtribucion" TEXT NOT NULL DEFAULT 'PRIMERA',
  "ventanaAtribucionDias" INTEGER NOT NULL DEFAULT 30,
  "monedaDefecto" TEXT NOT NULL DEFAULT 'DOP',
  "reglaAprobacion" TEXT NOT NULL DEFAULT 'MANUAL',
  "config" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "excursiones_config_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "excursiones_config_companyId_key" ON "excursiones_config"("companyId");

-- ── Vertical EXCURSIONES ────────────────────────────────────────────────────

INSERT INTO "tipos_negocio" ("id","codigo","nombre","orden","activo","createdAt","updatedAt")
VALUES (gen_random_uuid()::text, 'EXCURSIONES', 'Excursiones y Tours', 5, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("codigo") DO NOTHING;
