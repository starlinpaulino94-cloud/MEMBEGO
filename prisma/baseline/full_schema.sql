-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "CajaSesionEstado" AS ENUM ('ABIERTA', 'CERRADA');

-- CreateEnum
CREATE TYPE "MovimientoCajaTipo" AS ENUM ('ENTRADA', 'SALIDA');

-- CreateEnum
CREATE TYPE "RegaloTipo" AS ENUM ('TRANSFERENCIA_USOS', 'REGALO_COMPRA', 'REGALO_MEMBRESIA');

-- CreateEnum
CREATE TYPE "RegaloEstado" AS ENUM ('PENDIENTE', 'ACEPTADO', 'RECHAZADO', 'EXPIRADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "MetodoCobroTipo" AS ENUM ('EFECTIVO', 'TRANSFERENCIA', 'OTRO');

-- CreateEnum
CREATE TYPE "GiftCardEstado" AS ENUM ('PENDIENTE_PAGO', 'ACTIVA', 'AGOTADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "TransactionTipo" AS ENUM ('MEMBERSHIP_REDEMPTION', 'PROMOTION_USE', 'BENEFIT_USE', 'REWARD_REDEMPTION', 'COUPON_USE', 'POINTS_SPEND', 'REFERRAL', 'SALE', 'PURCHASE', 'OTHER');

-- CreateEnum
CREATE TYPE "TransactionEstado" AS ENUM ('PENDING', 'VALIDATING', 'APPROVED', 'APPLIED', 'CANCELLED', 'REVERTED', 'EXPIRED', 'ERROR');

-- CreateEnum
CREATE TYPE "MarketingCampaignTipo" AS ENUM ('FLASH_SALE', 'OFERTA_DIA', 'FIN_DE_SEMANA', 'HAPPY_HOUR', 'PRIMERA_COMPRA', 'BIENVENIDA', 'REGRESO', 'CUMPLEANOS', 'POR_VENCER', 'PERSONALIZADA');

-- CreateEnum
CREATE TYPE "MarketingCampaignEstado" AS ENUM ('BORRADOR', 'ACTIVA', 'PAUSADA', 'FINALIZADA');

-- CreateEnum
CREATE TYPE "RuletaPremioTipo" AS ENUM ('PROMOCION', 'NADA');

-- CreateEnum
CREATE TYPE "OfertaPeriodo" AS ENUM ('SEMANAL', 'MENSUAL', 'TOTAL');

-- CreateEnum
CREATE TYPE "OfertaPrivadaEstado" AS ENUM ('ACTIVA', 'PAUSADA', 'FINALIZADA');

-- CreateEnum
CREATE TYPE "CitaEstado" AS ENUM ('PENDIENTE', 'CONFIRMADA', 'COMPLETADA', 'CANCELADA', 'NO_ASISTIO');

-- CreateEnum
CREATE TYPE "InvitacionEstado" AS ENUM ('PENDIENTE', 'ACEPTADA', 'CANCELADA', 'EXPIRADA');

-- CreateEnum
CREATE TYPE "AppRole" AS ENUM ('SUPERADMIN', 'ADMIN_EMPRESA', 'EMPLEADO', 'CLIENTE', 'ADMINISTRADOR', 'GERENTE', 'CAJERO', 'RECEPCION', 'MARKETING', 'SUPERVISOR');

-- CreateEnum
CREATE TYPE "NotifTipo" AS ENUM ('PAGO_APROBADO', 'PAGO_RECHAZADO', 'NUEVO_COMPROBANTE', 'MEMBRESIA_POR_VENCER', 'MEMBRESIA_ACTIVADA', 'PROMOCION_NUEVA', 'RECOMPENSA_REFERIDO', 'SISTEMA', 'TICKET_NUEVO', 'TICKET_RESPUESTA', 'TICKET_ACTUALIZADO', 'CITA_NUEVA', 'CITA_CONFIRMADA', 'CITA_CANCELADA');

-- CreateEnum
CREATE TYPE "AuditAccion" AS ENUM ('VISITA_CONFIRMADA', 'PAGO_APROBADO', 'PAGO_RECHAZADO', 'MEMBRESIA_CANCELADA', 'MEMBRESIA_RENOVADA', 'QR_GENERADO', 'QR_USADO', 'QR_COMPARTIDO', 'CAJA_ABIERTA', 'CAJA_CERRADA', 'CAJA_MOVIMIENTO', 'COBRO_REGISTRADO', 'COMPROBANTE_IMPRESO', 'TRANSACCION_ANULADA', 'REFERIDO_COMPLETADO', 'RECOMPENSA_OTORGADA', 'NOTA_INTERNA', 'PLANTILLA_RECIBO_ACTUALIZADA', 'CUENTA_ELIMINADA', 'EMPRESA_DEMO_CAMBIADA', 'EMPRESA_DEMO_REINICIADA', 'SUPERADMIN_OTORGADO', 'SUPERADMIN_RETIRADO', 'ENTRAR_COMO_GENERADO');

-- CreateEnum
CREATE TYPE "MembershipEstado" AS ENUM ('PENDIENTE', 'PENDIENTE_PAGO', 'RECHAZADA', 'ACTIVA', 'VENCIDA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "MetodoPagoTipo" AS ENUM ('TRANSFERENCIA', 'PRESENCIAL');

-- CreateEnum
CREATE TYPE "RuleStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RuleMatchType" AS ENUM ('ALL', 'ANY');

-- CreateEnum
CREATE TYPE "RuleLogicalOperator" AS ENUM ('AND', 'OR', 'NOT', 'XOR');

-- CreateEnum
CREATE TYPE "PromotionStatus" AS ENUM ('DRAFT', 'PENDING', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'SUSPENDED', 'ENDED', 'ARCHIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DictionaryVariableStatus" AS ENUM ('ACTIVE', 'DEPRECATED', 'DISABLED');

-- CreateEnum
CREATE TYPE "MembershipPlanType" AS ENUM ('UNLIMITED', 'CREDITS', 'HYBRID', 'TIER', 'FAMILY', 'FLEET', 'CORPORATE', 'SEASONAL', 'PREMIUM', 'MAINTENANCE', 'PAY_PER_VISIT', 'LOYALTY', 'PREPAID', 'VIP', 'REWARDS', 'TRIAL', 'STUDENT', 'DRIVER', 'SUBSCRIPTION_BOX', 'CUSTOM');

-- CreateEnum
CREATE TYPE "MembershipPeriodicity" AS ENUM ('NONE', 'ONE_TIME', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL', 'SEASONAL');

-- CreateEnum
CREATE TYPE "MembershipInstanceStatus" AS ENUM ('PENDING', 'ACTIVE', 'PAUSED', 'SUSPENDED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BenefitType" AS ENUM ('SERVICE_FREE', 'DISCOUNT', 'UPGRADE', 'PRODUCT', 'POINTS', 'CREDIT', 'TIME', 'EXPERIENCE', 'ACCESS', 'CUSTOM');

-- CreateEnum
CREATE TYPE "BenefitGrantStatus" AS ENUM ('GRANTED', 'REDEEMED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "TransformationType" AS ENUM ('UPGRADE', 'DOWNGRADE', 'EXCHANGE', 'REPLACEMENT', 'CUSTOMIZATION', 'SPLIT', 'MERGE');

-- CreateEnum
CREATE TYPE "TransformationStatus" AS ENUM ('REQUESTED', 'RESOLVING', 'RESOLVED', 'PENDING_APPROVAL', 'APPROVED', 'PENDING_PAYMENT', 'EXECUTING', 'COMPLETED', 'REJECTED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReferralModel" AS ENUM ('CLASSIC', 'REFERRER_ONLY', 'REFERRED_ONLY', 'BOTH', 'PROGRESSIVE', 'AMBASSADOR', 'INFLUENCER', 'CORPORATE', 'EMPLOYEE', 'TEAM');

-- CreateEnum
CREATE TYPE "ReferralParticipantStatus" AS ENUM ('ACTIVE', 'PAUSED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "AutomationRunStatus" AS ENUM ('RUNNING', 'WAITING', 'SUCCESS', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "BeneficioTipo" AS ENUM ('PROMOTION', 'MEMBERSHIP', 'COUPON', 'VOUCHER', 'GIFT', 'EVENT');

-- CreateEnum
CREATE TYPE "ProductoComercialTipo" AS ENUM ('PROMOCION', 'MEMBRESIA');

-- CreateEnum
CREATE TYPE "CompraEstado" AS ENUM ('SOLICITADA', 'PENDIENTE_PAGO', 'EN_VALIDACION', 'APROBADA', 'ACTIVA', 'RECHAZADA', 'CONSUMIDA', 'EXPIRADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "PostTipo" AS ENUM ('EVENTO', 'NOTICIA', 'BENEFICIO');

-- CreateEnum
CREATE TYPE "ReferidoEstado" AS ENUM ('PENDIENTE', 'COMPLETADO');

-- CreateEnum
CREATE TYPE "CondicionRecompensa" AS ENUM ('N_REFERIDOS_COMPLETADOS');

-- CreateEnum
CREATE TYPE "TipoRecompensa" AS ENUM ('LAVADOS_GRATIS', 'DESCUENTO_PORCENTAJE', 'DESCUENTO_MONTO');

-- CreateEnum
CREATE TYPE "ReferralEventTipo" AS ENUM ('LINK', 'SHARE', 'CLICK', 'LANDING_VIEW', 'REGISTRO_INICIADO', 'REGISTRO', 'VERIFICADO', 'MEMBRESIA', 'COMPRA', 'PRIMER_USO', 'RECOMPENSA', 'FRAUDE', 'REGISTRO_GLOBAL', 'MEMBRESIA_GLOBAL');

-- CreateEnum
CREATE TYPE "ReferralRecompensaEstado" AS ENUM ('PENDIENTE', 'ENTREGADA', 'RECHAZADA');

-- CreateEnum
CREATE TYPE "GrowthTrigger" AS ENUM ('LINK_ABIERTO', 'REGISTRO', 'VERIFICADO', 'MEMBRESIA', 'COMPRA', 'PRIMER_USO', 'N_REFERIDOS');

-- CreateEnum
CREATE TYPE "GrowthRewardTipo" AS ENUM ('PUNTOS', 'CREDITOS', 'BENEFICIO', 'LAVADOS_GRATIS', 'DESCUENTO_PORCENTAJE', 'DESCUENTO_MONTO');

-- CreateEnum
CREATE TYPE "GrowthBeneficiario" AS ENUM ('REFERENTE', 'REFERIDO', 'AMBOS');

-- CreateEnum
CREATE TYPE "GrowthRewardEstado" AS ENUM ('PENDIENTE', 'ENTREGADA', 'RECHAZADA');

-- CreateEnum
CREATE TYPE "CampanaInvitacionEstado" AS ENUM ('BORRADOR', 'ACTIVA', 'PAUSADA', 'FINALIZADA');

-- CreateEnum
CREATE TYPE "InvitacionEventoTipo" AS ENUM ('COMPARTIDA', 'ENLACE_ABIERTO', 'LANDING_VISTA', 'REGISTRO_INICIADO', 'REGISTRO_COMPLETADO', 'PREMIO_RECLAMADO', 'MEMBRESIA_ADQUIRIDA', 'PRIMER_CANJE', 'CONVERSION_FINAL');

-- CreateEnum
CREATE TYPE "TicketEstado" AS ENUM ('NUEVO', 'EN_PROCESO', 'ESPERANDO_CLIENTE', 'RESUELTO', 'CERRADO');

-- CreateEnum
CREATE TYPE "TicketCategoria" AS ENUM ('PAGO', 'MEMBRESIA', 'BENEFICIOS', 'APP', 'OTRO');

-- CreateEnum
CREATE TYPE "TicketAutor" AS ENUM ('CLIENTE', 'ADMIN', 'SISTEMA');

-- CreateTable
CREATE TABLE "caja_sesiones" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sucursalId" TEXT NOT NULL,
    "estado" "CajaSesionEstado" NOT NULL DEFAULT 'ABIERTA',
    "abiertaPorId" TEXT NOT NULL,
    "cerradaPorId" TEXT,
    "turno" TEXT,
    "balanceInicial" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "balanceFinal" DECIMAL(10,2),
    "balanceEsperado" DECIMAL(10,2),
    "diferencia" DECIMAL(10,2),
    "observaciones" TEXT,
    "abiertaAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cerradaAt" TIMESTAMP(3),

    CONSTRAINT "caja_sesiones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimientos_caja" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "cajaSesionId" TEXT NOT NULL,
    "tipo" "MovimientoCajaTipo" NOT NULL,
    "monto" DECIMAL(10,2) NOT NULL,
    "concepto" TEXT NOT NULL,
    "registradoPorId" TEXT,
    "registradoPor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimientos_caja_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regalos" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "tipo" "RegaloTipo" NOT NULL,
    "estado" "RegaloEstado" NOT NULL DEFAULT 'PENDIENTE',
    "remitenteId" TEXT NOT NULL,
    "destinatarioId" TEXT,
    "destinatarioContacto" TEXT,
    "compraOrigenId" TEXT,
    "membershipOrigenId" TEXT,
    "promocionId" TEXT,
    "planId" TEXT,
    "usos" INTEGER NOT NULL DEFAULT 1,
    "mensaje" TEXT,
    "compraDestinoId" TEXT,
    "membershipDestinoId" TEXT,
    "txRemitenteId" TEXT,
    "txDestinatarioId" TEXT,
    "expiraAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resueltoAt" TIMESTAMP(3),

    CONSTRAINT "regalos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gift_cards" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "estado" "GiftCardEstado" NOT NULL DEFAULT 'PENDIENTE_PAGO',
    "monto" DECIMAL(10,2) NOT NULL,
    "saldo" DECIMAL(10,2) NOT NULL,
    "compradorClienteId" TEXT NOT NULL,
    "destinatarioClienteId" TEXT,
    "destinatarioContacto" TEXT,
    "mensaje" TEXT,
    "metodoCobro" "MetodoCobroTipo",
    "txVentaId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activadaAt" TIMESTAMP(3),
    "resueltoAt" TIMESTAMP(3),

    CONSTRAINT "gift_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "ticketNumero" TEXT NOT NULL,
    "tipo" "TransactionTipo" NOT NULL,
    "estado" "TransactionEstado" NOT NULL DEFAULT 'PENDING',
    "companyId" TEXT NOT NULL,
    "sucursalId" TEXT,
    "clienteId" TEXT,
    "empleadoId" TEXT,
    "caja" TEXT,
    "cajaSesionId" TEXT,
    "monto" DECIMAL(10,2),
    "metodoCobro" "MetodoCobroTipo",
    "membershipId" TEXT,
    "visitId" TEXT,
    "qrTokenUsadoId" TEXT,
    "snapshot" JSONB NOT NULL DEFAULT '{}',
    "auditoria" JSONB NOT NULL DEFAULT '{}',
    "resultado" TEXT,
    "errorDetalle" TEXT,
    "executionMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "revertedAt" TIMESTAMP(3),

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_transitions" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "desde" "TransactionEstado",
    "hacia" "TransactionEstado" NOT NULL,
    "motivo" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaction_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_counters" (
    "id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "transaction_counters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_prints" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "empleadoId" TEXT,
    "esCopia" BOOLEAN NOT NULL DEFAULT false,
    "numero" INTEGER NOT NULL,
    "motivo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipt_prints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_templates" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "receipt_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_campaigns" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "tipo" "MarketingCampaignTipo" NOT NULL DEFAULT 'FLASH_SALE',
    "estado" "MarketingCampaignEstado" NOT NULL DEFAULT 'BORRADOR',
    "titulo" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "imagenUrl" TEXT,
    "bannerUrl" TEXT,
    "ctaTexto" TEXT,
    "ctaHref" TEXT,
    "colorPrimario" TEXT,
    "colorSecundario" TEXT,
    "fechaInicio" TIMESTAMP(3) NOT NULL,
    "fechaFin" TIMESTAMP(3) NOT NULL,
    "horaInicioMin" INTEGER,
    "horaFinMin" INTEGER,
    "diasSemana" INTEGER[],
    "prioridad" INTEGER NOT NULL DEFAULT 0,
    "destacada" BOOLEAN NOT NULL DEFAULT false,
    "maxReclamos" INTEGER,
    "reclamosCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketing_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ruleta_premios" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" "RuletaPremioTipo" NOT NULL DEFAULT 'PROMOCION',
    "promocionId" TEXT,
    "probabilidad" INTEGER NOT NULL DEFAULT 1,
    "color" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ruleta_premios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ruleta_jugadas" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "costoPuntos" INTEGER NOT NULL,
    "premioId" TEXT,
    "premioNombre" TEXT NOT NULL,
    "gano" BOOLEAN NOT NULL DEFAULT false,
    "productoCompraId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ruleta_jugadas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ofertas_privadas" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descripcion" TEXT,
    "usosPorPeriodo" INTEGER NOT NULL DEFAULT 1,
    "periodo" "OfertaPeriodo" NOT NULL DEFAULT 'MENSUAL',
    "vigenciaHasta" TIMESTAMP(3),
    "estado" "OfertaPrivadaEstado" NOT NULL DEFAULT 'ACTIVA',
    "creadaPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ofertas_privadas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oferta_invitados" (
    "id" TEXT NOT NULL,
    "ofertaId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "reclamadaAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oferta_invitados_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oferta_usos" (
    "id" TEXT NOT NULL,
    "invitadoId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "registradoPorId" TEXT,
    "nota" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oferta_usos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campanas_globales" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "descripcion" TEXT,
    "imagenUrl" TEXT,
    "modo" TEXT NOT NULL DEFAULT 'COPIA',
    "plantilla" JSONB NOT NULL DEFAULT '{}',
    "estado" TEXT NOT NULL DEFAULT 'BORRADOR',
    "todasLasEmpresas" BOOLEAN NOT NULL DEFAULT false,
    "creadaPorId" TEXT,
    "aplicadaAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campanas_globales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campana_pasos" (
    "id" TEXT NOT NULL,
    "campanaId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "orden" INTEGER NOT NULL,
    "titulo" TEXT NOT NULL,
    "descripcion" TEXT,
    "imagenUrl" TEXT,
    "plantilla" JSONB NOT NULL DEFAULT '{}',
    "promocionId" TEXT,
    "error" TEXT,
    "aplicadaAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campana_pasos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campana_inscripciones" (
    "id" TEXT NOT NULL,
    "campanaId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "pasoActual" INTEGER NOT NULL DEFAULT 1,
    "estado" TEXT NOT NULL DEFAULT 'EN_CURSO',
    "completadaAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campana_inscripciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campana_global_empresas" (
    "id" TEXT NOT NULL,
    "campanaId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "promocionId" TEXT,
    "planId" TEXT,
    "error" TEXT,
    "aplicadaAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campana_global_empresas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cola_vehiculos" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sucursalId" TEXT,
    "clienteId" TEXT,
    "vehiculoId" TEXT,
    "placa" TEXT,
    "descripcion" TEXT,
    "servicio" TEXT,
    "notaInterna" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'EN_ESPERA',
    "inicioAt" TIMESTAMP(3),
    "listoAt" TIMESTAMP(3),
    "entregadoAt" TIMESTAMP(3),
    "registradaPorId" TEXT,
    "atendidoPorId" TEXT,
    "bahiaId" TEXT,
    "tipoVehiculoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cola_vehiculos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "productos_inventario" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "categoria" TEXT,
    "unidad" TEXT NOT NULL DEFAULT 'unidad',
    "stock" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "stockMinimo" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "costo" DECIMAL(12,2),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "notas" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "proveedorId" TEXT,

    CONSTRAINT "productos_inventario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimientos_inventario" (
    "id" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "cantidad" DECIMAL(12,2) NOT NULL,
    "stockResultante" DECIMAL(12,2) NOT NULL,
    "motivo" TEXT,
    "registradoPorId" TEXT,
    "ordenCompraId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimientos_inventario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidencias_foto" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "colaId" TEXT,
    "clienteId" TEXT,
    "vehiculoId" TEXT,
    "placa" TEXT,
    "momento" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "nota" TEXT,
    "subidaPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidencias_foto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tipos_vehiculo" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "nivelTarifario" INTEGER NOT NULL DEFAULT 1,
    "descripcion" TEXT,
    "iconoUrl" TEXT,

    CONSTRAINT "tipos_vehiculo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "servicios" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "categoria" TEXT,
    "duracionMin" INTEGER NOT NULL DEFAULT 30,
    "esAdicional" BOOLEAN NOT NULL DEFAULT false,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "comisionPorcentaje" DECIMAL(5,2),
    "comisionMonto" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "servicios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "servicio_precios" (
    "id" TEXT NOT NULL,
    "servicioId" TEXT NOT NULL,
    "tipoVehiculoId" TEXT NOT NULL,
    "precio" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "servicio_precios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bahias" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sucursalId" TEXT,
    "nombre" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bahias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cola_servicios" (
    "id" TEXT NOT NULL,
    "colaId" TEXT NOT NULL,
    "servicioId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "precio" DECIMAL(10,2) NOT NULL,
    "cantidad" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cola_servicios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cuentas_corporativas" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "rnc" TEXT,
    "contacto" TEXT,
    "telefono" TEXT,
    "email" TEXT,
    "limiteCredito" DECIMAL(12,2),
    "diasCredito" INTEGER NOT NULL DEFAULT 30,
    "notas" TEXT,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cuentas_corporativas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cuenta_vehiculos" (
    "id" TEXT NOT NULL,
    "cuentaId" TEXT NOT NULL,
    "placa" TEXT NOT NULL,
    "alias" TEXT,
    "vehiculoId" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cuenta_vehiculos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cargos_cuenta" (
    "id" TEXT NOT NULL,
    "cuentaId" TEXT NOT NULL,
    "colaId" TEXT,
    "placa" TEXT,
    "concepto" TEXT NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "corteRef" TEXT,
    "facturadoAt" TIMESTAMP(3),
    "pagadoAt" TIMESTAMP(3),
    "notas" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cargos_cuenta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comisiones" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "colaId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "base" DECIMAL(12,2) NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "detalle" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "loteRef" TEXT,
    "pagadaAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comisiones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidencias" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "colaId" TEXT,
    "rewashColaId" TEXT,
    "clienteId" TEXT,
    "vehiculoId" TEXT,
    "placa" TEXT,
    "tipo" TEXT NOT NULL,
    "gravedad" TEXT NOT NULL DEFAULT 'MEDIA',
    "descripcion" TEXT NOT NULL,
    "costo" DECIMAL(12,2),
    "estado" TEXT NOT NULL DEFAULT 'ABIERTA',
    "resolucion" TEXT,
    "resueltaAt" TIMESTAMP(3),
    "reportadaPorId" TEXT,
    "responsableId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incidencias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proveedores" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "rnc" TEXT,
    "contacto" TEXT,
    "telefono" TEXT,
    "email" TEXT,
    "diasCredito" INTEGER NOT NULL DEFAULT 0,
    "notas" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proveedores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ordenes_compra" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "proveedorId" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'BORRADOR',
    "total" DECIMAL(12,2),
    "notas" TEXT,
    "pedidaAt" TIMESTAMP(3),
    "recibidaAt" TIMESTAMP(3),
    "creadaPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ordenes_compra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orden_compra_lineas" (
    "id" TEXT NOT NULL,
    "ordenId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "cantidad" DECIMAL(12,2) NOT NULL,
    "cantidadRecibida" DECIMAL(12,2),
    "costoUnitario" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orden_compra_lineas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activos" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "categoria" TEXT,
    "marca" TEXT,
    "modelo" TEXT,
    "serie" TEXT,
    "ubicacion" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'OPERATIVO',
    "fechaCompra" TIMESTAMP(3),
    "costo" DECIMAL(12,2),
    "frecuenciaDias" INTEGER NOT NULL DEFAULT 0,
    "proximoMantenimiento" TIMESTAMP(3),
    "notas" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "activos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mantenimientos" (
    "id" TEXT NOT NULL,
    "activoId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "costo" DECIMAL(12,2),
    "horasParado" DECIMAL(8,2),
    "realizadoAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hechoPorId" TEXT,
    "proveedor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mantenimientos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "turnos" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entradaAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "salidaAt" TIMESTAMP(3),
    "costoHora" DECIMAL(10,2),
    "notas" TEXT,
    "cerradoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "turnos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agenda_configs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT false,
    "duracionMin" INTEGER NOT NULL DEFAULT 30,
    "maxPorSlot" INTEGER NOT NULL DEFAULT 1,
    "maxPorDia" INTEGER NOT NULL DEFAULT 0,
    "anticipacionHoras" INTEGER NOT NULL DEFAULT 1,
    "ventanaDias" INTEGER NOT NULL DEFAULT 14,
    "autoConfirmar" BOOLEAN NOT NULL DEFAULT true,
    "notas" TEXT,
    "horarios" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agenda_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "citas" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "sucursalId" TEXT,
    "vehiculoId" TEXT,
    "inicio" TIMESTAMP(3) NOT NULL,
    "duracionMin" INTEGER NOT NULL,
    "servicio" TEXT,
    "notaCliente" TEXT,
    "notaInterna" TEXT,
    "estado" "CitaEstado" NOT NULL DEFAULT 'CONFIRMADA',
    "canceladaPor" TEXT,
    "motivoCancelacion" TEXT,
    "atendidaPorId" TEXT,
    "compraId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "citas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitaciones" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "rol" "AppRole" NOT NULL,
    "token" TEXT NOT NULL,
    "estado" "InvitacionEstado" NOT NULL DEFAULT 'PENDIENTE',
    "invitadoPor" TEXT,
    "expiraEn" TIMESTAMP(3) NOT NULL,
    "aceptadaEn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clientes" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "supabaseId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "telefono" TEXT,
    "email" TEXT NOT NULL,
    "esLocal" BOOLEAN NOT NULL DEFAULT false,
    "cardnetCustomerId" TEXT,
    "fechaNacimiento" TIMESTAMP(3),
    "avatarUrl" TEXT,
    "ciudad" TEXT,
    "genero" TEXT,
    "idioma" TEXT,
    "notifPromos" BOOLEAN NOT NULL DEFAULT true,
    "notifRecordatorios" BOOLEAN NOT NULL DEFAULT true,
    "canalOrigen" TEXT,
    "codigoReferido" TEXT NOT NULL,
    "codigoCorto" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehiculos" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "marca" TEXT NOT NULL,
    "modelo" TEXT NOT NULL,
    "anio" INTEGER NOT NULL,
    "color" TEXT NOT NULL,
    "placa" TEXT,
    "placaNormalizada" TEXT,
    "pais" TEXT NOT NULL DEFAULT 'DO',
    "esPrincipal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tipoVehiculoId" TEXT,

    CONSTRAINT "vehiculos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cliente_notas" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "autorId" TEXT,
    "texto" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cliente_notas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_intereses" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_intereses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "supabaseId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "AppRole" NOT NULL DEFAULT 'CLIENTE',
    "companyId" TEXT,
    "termsAcceptedAt" TIMESTAMP(3),
    "termsVersion" TEXT,
    "marketingConsent" BOOLEAN NOT NULL DEFAULT false,
    "marketingConsentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_company_access" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_company_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "logoUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "email" TEXT,
    "telefono" TEXT,
    "direccion" TEXT,
    "ciudad" TEXT,
    "categoria" TEXT,
    "website" TEXT,
    "esDemo" BOOLEAN NOT NULL DEFAULT false,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "featuredOrder" INTEGER,
    "bannerUrl" TEXT,
    "galleryImages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "provincia" TEXT,
    "pais" TEXT,
    "razonSocial" TEXT,
    "codigoPostal" TEXT,
    "latitud" DOUBLE PRECISION,
    "longitud" DOUBLE PRECISION,
    "zonaCobertura" TEXT,
    "moneda" TEXT NOT NULL DEFAULT 'DOP',
    "zonaHoraria" TEXT NOT NULL DEFAULT 'America/Santo_Domingo',
    "idioma" TEXT NOT NULL DEFAULT 'es-DO',
    "escanerModo" TEXT NOT NULL DEFAULT 'camara',
    "colorPrimario" TEXT,
    "engagementConfig" JSONB,
    "politicaCancelacion" TEXT,
    "politicaPrivacidad" TEXT,
    "terminosEmpresa" TEXT,
    "whatsapp" TEXT,
    "instagram" TEXT,
    "facebook" TEXT,
    "tiktok" TEXT,
    "googleMapsUrl" TEXT,
    "horario" TEXT,
    "totalMembersCount" INTEGER NOT NULL DEFAULT 0,
    "activePromotionsCount" INTEGER NOT NULL DEFAULT 0,
    "averageRating" DECIMAL(3,2),
    "bienvenidaActiva" BOOLEAN NOT NULL DEFAULT false,
    "bienvenidaTipo" TEXT NOT NULL DEFAULT 'PORCENTAJE',
    "bienvenidaValor" DECIMAL(10,2),
    "regalosConfig" JSONB,
    "capacidades" JSONB,
    "seguimientoConfig" JSONB,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sucursales" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "direccion" TEXT,
    "telefono" TEXT,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sucursales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "userId" TEXT,
    "accion" "AuditAccion" NOT NULL,
    "entidadTipo" TEXT NOT NULL,
    "entidadId" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notificaciones" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tipo" "NotifTipo" NOT NULL,
    "titulo" TEXT NOT NULL,
    "mensaje" TEXT NOT NULL,
    "href" TEXT,
    "leida" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notificaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sistemas_conectados" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "urlBase" TEXT NOT NULL,
    "urlWebhook" TEXT,
    "secreto" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sistemas_conectados_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eventos_salientes" (
    "id" TEXT NOT NULL,
    "sistemaId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "ultimoError" TEXT,
    "enviadoAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eventos_salientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "icon" TEXT,
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_to_categories" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_to_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_ratings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_follows" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "esFavorita" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_follows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promociones_guardadas" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "promocionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promociones_guardadas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metodos_pago" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "tipo" "MetodoPagoTipo" NOT NULL,
    "nombre" TEXT NOT NULL,
    "titular" TEXT,
    "numeroCuenta" TEXT,
    "tipoCuenta" TEXT,
    "instrucciones" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "metodos_pago_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "precio" DECIMAL(10,2) NOT NULL,
    "lavadosIncluidos" INTEGER NOT NULL DEFAULT 0,
    "esIlimitado" BOOLEAN NOT NULL DEFAULT false,
    "descripcion" TEXT,
    "beneficios" TEXT[],
    "vigenciaDias" INTEGER NOT NULL DEFAULT 30,
    "condiciones" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "color" TEXT,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "nivelTarifarioMax" INTEGER,
    "maxVehiculos" INTEGER NOT NULL DEFAULT 1,
    "precioVehiculoExtra" DECIMAL(10,2),

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "planIdSolicitado" TEXT,
    "userId" TEXT,
    "metodoPagoId" TEXT,
    "referencia" TEXT,
    "sucursalPagoId" TEXT,
    "estado" "MembershipEstado" NOT NULL DEFAULT 'PENDIENTE',
    "comprobanteUrl" TEXT,
    "comprobanteNota" TEXT,
    "rechazadoReason" TEXT,
    "adminNota" TEXT,
    "pagoConfirmado" BOOLEAN NOT NULL DEFAULT false,
    "montoPagado" DECIMAL(10,2),
    "descuentoBienvenida" DECIMAL(10,2),
    "beneficiarioClienteId" TEXT,
    "autoRenovar" BOOLEAN NOT NULL DEFAULT false,
    "tarjetaTokenizadaId" TEXT,
    "fechaInicio" TIMESTAMP(3),
    "fechaVencimiento" TIMESTAMP(3),
    "lavadosRestantes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_precios_categoria" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "tipoVehiculoId" TEXT NOT NULL,
    "precio" DECIMAL(10,2) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_precios_categoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membresia_vehiculos" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "vehiculoId" TEXT NOT NULL,
    "nivelTarifarioComprado" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membresia_vehiculos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tarjetas_tokenizadas" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "paymentProfileId" TEXT,
    "token" TEXT,
    "marca" TEXT,
    "ultimos4" TEXT,
    "vencMes" INTEGER,
    "vencAnio" INTEGER,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tarjetas_tokenizadas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qr_tokens" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "membresiaId" TEXT,
    "compraId" TEXT,
    "token" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "expiraAt" TIMESTAMP(3),
    "compartidoCount" INTEGER NOT NULL DEFAULT 0,
    "ultimoCompartido" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qr_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visits" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "vehiculoId" TEXT,
    "membershipId" TEXT NOT NULL,
    "sucursalId" TEXT,
    "empleadoId" TEXT,
    "servicio" TEXT NOT NULL,
    "descontado" BOOLEAN NOT NULL DEFAULT false,
    "fechaVisita" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notas" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comprobantes" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "impresiones" INTEGER NOT NULL DEFAULT 0,
    "ultimaImpresion" TIMESTAMP(3),
    "creadoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comprobantes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rule_groups" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rule_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rules" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "groupId" TEXT,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "status" "RuleStatus" NOT NULL DEFAULT 'DRAFT',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "prioridad" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "matchType" "RuleMatchType" NOT NULL DEFAULT 'ALL',
    "validoDesde" TIMESTAMP(3),
    "validoHasta" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rule_conditions" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "groupId" TEXT,
    "campo" TEXT NOT NULL,
    "operador" TEXT NOT NULL,
    "valor" JSONB NOT NULL DEFAULT 'null',
    "tipoValor" TEXT NOT NULL DEFAULT 'STRING',
    "conditionType" TEXT NOT NULL DEFAULT 'field',
    "dataType" TEXT NOT NULL DEFAULT 'TEXT',
    "orden" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rule_conditions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rule_condition_groups" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "parentId" TEXT,
    "operator" "RuleLogicalOperator" NOT NULL DEFAULT 'AND',
    "orden" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rule_condition_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rule_actions" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "orden" INTEGER NOT NULL DEFAULT 0,
    "obligatoria" BOOLEAN NOT NULL DEFAULT true,
    "maxReintentos" INTEGER NOT NULL DEFAULT 0,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rule_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rule_execution_logs" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT,
    "companyId" TEXT NOT NULL,
    "matched" BOOLEAN NOT NULL,
    "resultado" JSONB NOT NULL DEFAULT '{}',
    "contexto" JSONB NOT NULL DEFAULT '{}',
    "duracionMs" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rule_execution_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "categoria" TEXT,
    "status" "PromotionStatus" NOT NULL DEFAULT 'DRAFT',
    "prioridad" INTEGER NOT NULL DEFAULT 0,
    "inicioEn" TIMESTAMP(3),
    "finEn" TIMESTAMP(3),
    "config" JSONB NOT NULL DEFAULT '{}',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "creadoPorId" TEXT,
    "editadoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_rules" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotion_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_actions" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "orden" INTEGER NOT NULL DEFAULT 0,
    "obligatoria" BOOLEAN NOT NULL DEFAULT true,
    "maxReintentos" INTEGER NOT NULL DEFAULT 0,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotion_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_restrictions" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "valor" INTEGER,
    "config" JSONB NOT NULL DEFAULT '{}',
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotion_restrictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_versions" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "resumen" TEXT,
    "creadoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotion_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_audits" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "accion" TEXT NOT NULL,
    "estadoAnterior" "PromotionStatus",
    "estadoNuevo" "PromotionStatus",
    "cambios" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotion_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_dictionary_variables" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "key" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "semanticType" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subcategory" TEXT,
    "ownerModule" TEXT,
    "source" TEXT NOT NULL DEFAULT 'CONTEXT',
    "contextPath" TEXT,
    "format" TEXT,
    "unit" TEXT,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "DictionaryVariableStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "validation" JSONB NOT NULL DEFAULT '{}',
    "i18n" JSONB NOT NULL DEFAULT '{}',
    "calculated" JSONB,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_dictionary_variables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_dictionary_variable_versions" (
    "id" TEXT NOT NULL,
    "variableId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_dictionary_variable_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_plans" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "tipo" "MembershipPlanType" NOT NULL,
    "precio" DECIMAL(10,2) NOT NULL,
    "moneda" TEXT NOT NULL DEFAULT 'DOP',
    "periodicidad" "MembershipPeriodicity" NOT NULL DEFAULT 'MONTHLY',
    "duracionDias" INTEGER,
    "creditos" INTEGER,
    "ilimitado" BOOLEAN NOT NULL DEFAULT false,
    "templateKey" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "membership_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_instances" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "subscriberId" TEXT NOT NULL,
    "subscriberKind" TEXT NOT NULL DEFAULT 'CLIENT',
    "status" "MembershipInstanceStatus" NOT NULL DEFAULT 'PENDING',
    "inicioEn" TIMESTAMP(3),
    "finEn" TIMESTAMP(3),
    "renuevaEn" TIMESTAMP(3),
    "autoRenovar" BOOLEAN NOT NULL DEFAULT false,
    "creditosRestantes" INTEGER,
    "vehiculos" JSONB NOT NULL DEFAULT '[]',
    "config" JSONB NOT NULL DEFAULT '{}',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "membership_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_usage" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "servicio" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL DEFAULT 1,
    "vehiculo" TEXT,
    "usadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "meta" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "membership_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "benefits" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "categoria" TEXT NOT NULL,
    "tipo" "BenefitType" NOT NULL,
    "valorPercibido" DECIMAL(10,2),
    "costoReal" DECIMAL(10,2),
    "templateKey" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "benefits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "benefit_grants" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "benefitId" TEXT NOT NULL,
    "subscriberId" TEXT NOT NULL,
    "subscriberKind" TEXT NOT NULL DEFAULT 'CLIENT',
    "sourceModule" TEXT NOT NULL,
    "status" "BenefitGrantStatus" NOT NULL DEFAULT 'GRANTED',
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redeemedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "meta" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "benefit_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "benefit_transformations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "subscriberId" TEXT NOT NULL,
    "subscriberKind" TEXT NOT NULL DEFAULT 'CLIENT',
    "type" "TransformationType" NOT NULL,
    "status" "TransformationStatus" NOT NULL DEFAULT 'REQUESTED',
    "sourceBenefitId" TEXT NOT NULL,
    "sourceGrantId" TEXT,
    "targetBenefitId" TEXT,
    "targetGrantId" TEXT,
    "sourceValue" DECIMAL(10,2),
    "targetValue" DECIMAL(10,2),
    "differenceAmount" DECIMAL(10,2),
    "resolvedAmount" DECIMAL(10,2),
    "resolution" JSONB NOT NULL DEFAULT '{}',
    "policyId" TEXT,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "sucursalId" TEXT,
    "requestedById" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "benefit_transformations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transformation_policies" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "tipo" "TransformationType" NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "prioridad" INTEGER NOT NULL DEFAULT 0,
    "config" JSONB NOT NULL DEFAULT '{}',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transformation_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_programs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "objetivo" TEXT,
    "type" "ReferralModel" NOT NULL,
    "templateKey" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "referral_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_participants" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "referrerKind" TEXT NOT NULL DEFAULT 'CLIENT',
    "code" TEXT NOT NULL,
    "status" "ReferralParticipantStatus" NOT NULL DEFAULT 'ACTIVE',
    "level" INTEGER NOT NULL DEFAULT 0,
    "referralsCount" INTEGER NOT NULL DEFAULT 0,
    "convertedCount" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "referral_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_referrals" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "referredId" TEXT,
    "referredKind" TEXT NOT NULL DEFAULT 'CLIENT',
    "state" TEXT NOT NULL DEFAULT 'INVITED',
    "history" JSONB NOT NULL DEFAULT '[]',
    "suspicious" BOOLEAN NOT NULL DEFAULT false,
    "fraudReasons" JSONB NOT NULL DEFAULT '[]',
    "rewardReleased" BOOLEAN NOT NULL DEFAULT false,
    "rewardGrantId" TEXT,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "meta" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "referral_referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "objetivo" TEXT,
    "templateKey" TEXT,
    "triggerType" TEXT NOT NULL,
    "triggerEvent" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_runs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "status" "AutomationRunStatus" NOT NULL DEFAULT 'RUNNING',
    "subjectId" TEXT,
    "subjectKind" TEXT,
    "triggeredBy" TEXT,
    "rulesEvaluated" JSONB NOT NULL DEFAULT '[]',
    "actionsRun" JSONB NOT NULL DEFAULT '[]',
    "result" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "durationMs" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "meta" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_events" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "subjectId" TEXT,
    "subjectKind" TEXT DEFAULT 'CLIENT',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "source" TEXT,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pago_intentos" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "clienteId" TEXT,
    "proveedor" TEXT NOT NULL,
    "compraId" TEXT,
    "membershipId" TEXT,
    "monto" DECIMAL(10,2) NOT NULL,
    "moneda" TEXT NOT NULL DEFAULT 'DOP',
    "estado" TEXT NOT NULL DEFAULT 'CREADO',
    "referenciaExterna" TEXT,
    "autorizacion" TEXT,
    "motivoRechazo" TEXT,
    "respuesta" JSONB,
    "activadoAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pago_intentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promociones" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "imagenUrl" TEXT,
    "vigenciaDesde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vigenciaHasta" TIMESTAMP(3),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "publicadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "shareConfig" JSONB,
    "slug" TEXT,
    "tipo" TEXT NOT NULL DEFAULT 'general',
    "descuento" INTEGER,
    "codigo" TEXT,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "featuredOrder" INTEGER,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "shareCount" INTEGER NOT NULL DEFAULT 0,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "visibilidad" TEXT NOT NULL DEFAULT 'publica',
    "maxCanjes" INTEGER,
    "campanaId" TEXT,
    "canjes" INTEGER NOT NULL DEFAULT 0,
    "prioridad" INTEGER NOT NULL DEFAULT 0,
    "archivada" BOOLEAN NOT NULL DEFAULT false,
    "esComprable" BOOLEAN NOT NULL DEFAULT false,
    "precio" DECIMAL(10,2),
    "usosPorCompra" INTEGER NOT NULL DEFAULT 1,
    "limitePorCliente" INTEGER,
    "beneficioVigenciaDias" INTEGER,
    "beneficioVigenciaHasta" TIMESTAMP(3),
    "diasPermitidos" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "horaDesde" TEXT,
    "horaHasta" TEXT,
    "imagenes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "beneficioTipo" "BeneficioTipo" NOT NULL DEFAULT 'PROMOTION',

    CONSTRAINT "promociones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "producto_compras" (
    "id" TEXT NOT NULL,
    "tipo" "ProductoComercialTipo" NOT NULL DEFAULT 'PROMOCION',
    "estado" "CompraEstado" NOT NULL DEFAULT 'SOLICITADA',
    "campanaPasoId" TEXT,
    "companyId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "promocionId" TEXT,
    "metodoPagoId" TEXT,
    "precioCongelado" DECIMAL(10,2),
    "montoPagado" DECIMAL(10,2),
    "pagoConfirmado" BOOLEAN NOT NULL DEFAULT false,
    "comprobanteUrl" TEXT,
    "comprobanteNota" TEXT,
    "transferenciaFecha" TIMESTAMP(3),
    "rechazadoReason" TEXT,
    "adminNota" TEXT,
    "aprobadaPorId" TEXT,
    "referencia" TEXT,
    "sucursalPagoId" TEXT,
    "beneficiarioClienteId" TEXT,
    "usosIncluidos" INTEGER NOT NULL DEFAULT 1,
    "usosRestantes" INTEGER NOT NULL DEFAULT 0,
    "fechaActivacion" TIMESTAMP(3),
    "fechaVencimiento" TIMESTAMP(3),
    "consumidaAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "producto_compras_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "producto_compra_transiciones" (
    "id" TEXT NOT NULL,
    "compraId" TEXT NOT NULL,
    "desde" "CompraEstado",
    "hacia" "CompraEstado" NOT NULL,
    "motivo" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "producto_compra_transiciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_posts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "tipo" "PostTipo" NOT NULL,
    "titulo" TEXT NOT NULL,
    "contenido" TEXT NOT NULL,
    "imagenUrl" TEXT,
    "fechaEvento" TIMESTAMP(3),
    "lugar" TEXT,
    "campanaId" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "publicadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campanas" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "fechaInicio" TIMESTAMP(3),
    "fechaFin" TIMESTAMP(3),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campanas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_events" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "tipo" "ReferralEventTipo" NOT NULL,
    "puntos" INTEGER NOT NULL DEFAULT 0,
    "canal" TEXT,
    "visitorId" TEXT,
    "referidoClienteId" TEXT,
    "growthLinkId" TEXT,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referidos" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "referenteClienteId" TEXT NOT NULL,
    "referidoClienteId" TEXT NOT NULL,
    "estado" "ReferidoEstado" NOT NULL DEFAULT 'PENDIENTE',
    "recompensaAplicada" BOOLEAN NOT NULL DEFAULT false,
    "sospechoso" BOOLEAN NOT NULL DEFAULT false,
    "campanaInvitacionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completadoEn" TIMESTAMP(3),

    CONSTRAINT "referidos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_recompensas" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "referenteClienteId" TEXT NOT NULL,
    "reglaId" TEXT NOT NULL,
    "estado" "ReferralRecompensaEstado" NOT NULL DEFAULT 'PENDIENTE',
    "tipo" "TipoRecompensa" NOT NULL,
    "valor" INTEGER NOT NULL,
    "descripcion" TEXT NOT NULL,
    "umbral" INTEGER NOT NULL,
    "completadosAlOtorgar" INTEGER NOT NULL,
    "entregadaAt" TIMESTAMP(3),
    "motivoRechazo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_recompensas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reglas_recompensa" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "condicion" "CondicionRecompensa" NOT NULL,
    "valorCondicion" INTEGER NOT NULL,
    "tipoRecompensa" "TipoRecompensa" NOT NULL,
    "valorRecompensa" DECIMAL(10,2) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reglas_recompensa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_links" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "promocionId" TEXT,
    "campanaId" TEXT,
    "titulo" TEXT,
    "mensaje" TEXT,
    "canal" TEXT,
    "duracionHoras" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "growth_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_configs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "landingActiva" BOOLEAN NOT NULL DEFAULT true,
    "duracionHorasDefault" INTEGER NOT NULL DEFAULT 24,
    "premiaClic" BOOLEAN NOT NULL DEFAULT false,
    "premiaRegistro" BOOLEAN NOT NULL DEFAULT true,
    "premiaMembresia" BOOLEAN NOT NULL DEFAULT true,
    "premiaCompra" BOOLEAN NOT NULL DEFAULT true,
    "premiaRenovacion" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "growth_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_rules" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "campanaId" TEXT,
    "nombre" TEXT NOT NULL,
    "trigger" "GrowthTrigger" NOT NULL,
    "valorCondicion" INTEGER NOT NULL DEFAULT 1,
    "planId" TEXT,
    "beneficiario" "GrowthBeneficiario" NOT NULL DEFAULT 'REFERENTE',
    "recompensaTipo" "GrowthRewardTipo" NOT NULL,
    "recompensaValor" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "recompensaPromocionId" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "growth_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_rewards" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "growthLinkId" TEXT,
    "referidoId" TEXT,
    "trigger" "GrowthTrigger" NOT NULL,
    "tipo" "GrowthRewardTipo" NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "descripcion" TEXT NOT NULL,
    "estado" "GrowthRewardEstado" NOT NULL DEFAULT 'PENDIENTE',
    "productoCompraId" TEXT,
    "entregadaAt" TIMESTAMP(3),
    "motivoRechazo" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "growth_rewards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_wallets" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "puntos" INTEGER NOT NULL DEFAULT 0,
    "creditos" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "growth_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campanas_invitacion" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "textoLanding" TEXT,
    "imagenUrl" TEXT,
    "bannerUrl" TEXT,
    "metaRegistros" INTEGER NOT NULL,
    "beneficioInvitante" JSONB NOT NULL,
    "beneficioInvitado" JSONB NOT NULL,
    "fechaInicio" TIMESTAMP(3) NOT NULL,
    "fechaFin" TIMESTAMP(3) NOT NULL,
    "maxPremios" INTEGER,
    "premiosOtorgados" INTEGER NOT NULL DEFAULT 0,
    "estado" "CampanaInvitacionEstado" NOT NULL DEFAULT 'BORRADOR',
    "colorPrimario" TEXT,
    "colorSecundario" TEXT,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "usarBanner" BOOLEAN NOT NULL DEFAULT false,
    "contenido" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campanas_invitacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitacion_progresos" (
    "id" TEXT NOT NULL,
    "campanaId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "registrosCompletados" INTEGER NOT NULL DEFAULT 0,
    "metaAlcanzada" BOOLEAN NOT NULL DEFAULT false,
    "premioReclamado" BOOLEAN NOT NULL DEFAULT false,
    "benefitGrantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invitacion_progresos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitacion_eventos" (
    "id" TEXT NOT NULL,
    "campanaId" TEXT NOT NULL,
    "clienteId" TEXT,
    "companyId" TEXT NOT NULL,
    "tipo" "InvitacionEventoTipo" NOT NULL,
    "canal" TEXT,
    "dispositivo" TEXT,
    "ipHash" TEXT,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitacion_eventos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_config" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "codigoPais" TEXT NOT NULL DEFAULT '+1',
    "numero" TEXT NOT NULL,
    "mensajePlantilla" TEXT NOT NULL DEFAULT 'Hola, quisiera más información.',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "correoSoporte" TEXT,
    "horaInicio" TEXT,
    "horaCierre" TEXT,
    "diasLaborales" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faq_items" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "pregunta" TEXT NOT NULL,
    "respuesta" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "faq_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "asunto" TEXT NOT NULL,
    "categoria" "TicketCategoria" NOT NULL DEFAULT 'OTRO',
    "estado" "TicketEstado" NOT NULL DEFAULT 'NUEVO',
    "adjuntoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_mensajes" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "autorTipo" "TicketAutor" NOT NULL,
    "autorNombre" TEXT NOT NULL,
    "cuerpo" TEXT NOT NULL,
    "esNotaInterna" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_mensajes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "caja_sesiones_sucursalId_estado_idx" ON "caja_sesiones"("sucursalId", "estado");

-- CreateIndex
CREATE INDEX "caja_sesiones_companyId_abiertaAt_idx" ON "caja_sesiones"("companyId", "abiertaAt");

-- CreateIndex
CREATE INDEX "movimientos_caja_cajaSesionId_idx" ON "movimientos_caja"("cajaSesionId");

-- CreateIndex
CREATE INDEX "movimientos_caja_companyId_createdAt_idx" ON "movimientos_caja"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "regalos_destinatarioId_estado_idx" ON "regalos"("destinatarioId", "estado");

-- CreateIndex
CREATE INDEX "regalos_remitenteId_createdAt_idx" ON "regalos"("remitenteId", "createdAt");

-- CreateIndex
CREATE INDEX "regalos_companyId_createdAt_idx" ON "regalos"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "gift_cards_codigo_key" ON "gift_cards"("codigo");

-- CreateIndex
CREATE INDEX "gift_cards_companyId_estado_createdAt_idx" ON "gift_cards"("companyId", "estado", "createdAt");

-- CreateIndex
CREATE INDEX "gift_cards_destinatarioClienteId_estado_idx" ON "gift_cards"("destinatarioClienteId", "estado");

-- CreateIndex
CREATE INDEX "gift_cards_compradorClienteId_createdAt_idx" ON "gift_cards"("compradorClienteId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_codigo_key" ON "transactions"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_visitId_key" ON "transactions"("visitId");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_qrTokenUsadoId_key" ON "transactions"("qrTokenUsadoId");

-- CreateIndex
CREATE INDEX "transactions_companyId_estado_idx" ON "transactions"("companyId", "estado");

-- CreateIndex
CREATE INDEX "transactions_companyId_createdAt_idx" ON "transactions"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "transactions_clienteId_createdAt_idx" ON "transactions"("clienteId", "createdAt");

-- CreateIndex
CREATE INDEX "transactions_empleadoId_idx" ON "transactions"("empleadoId");

-- CreateIndex
CREATE INDEX "transactions_cajaSesionId_idx" ON "transactions"("cajaSesionId");

-- CreateIndex
CREATE INDEX "transaction_transitions_transactionId_createdAt_idx" ON "transaction_transitions"("transactionId", "createdAt");

-- CreateIndex
CREATE INDEX "receipt_prints_transactionId_idx" ON "receipt_prints"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_templates_companyId_key" ON "receipt_templates"("companyId");

-- CreateIndex
CREATE INDEX "marketing_campaigns_companyId_estado_fechaInicio_fechaFin_idx" ON "marketing_campaigns"("companyId", "estado", "fechaInicio", "fechaFin");

-- CreateIndex
CREATE INDEX "marketing_campaigns_estado_fechaFin_idx" ON "marketing_campaigns"("estado", "fechaFin");

-- CreateIndex
CREATE INDEX "ruleta_premios_companyId_activo_idx" ON "ruleta_premios"("companyId", "activo");

-- CreateIndex
CREATE INDEX "ruleta_jugadas_companyId_clienteId_idx" ON "ruleta_jugadas"("companyId", "clienteId");

-- CreateIndex
CREATE INDEX "ruleta_jugadas_clienteId_createdAt_idx" ON "ruleta_jugadas"("clienteId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ofertas_privadas_codigo_key" ON "ofertas_privadas"("codigo");

-- CreateIndex
CREATE INDEX "ofertas_privadas_companyId_estado_idx" ON "ofertas_privadas"("companyId", "estado");

-- CreateIndex
CREATE INDEX "oferta_invitados_clienteId_idx" ON "oferta_invitados"("clienteId");

-- CreateIndex
CREATE UNIQUE INDEX "oferta_invitados_ofertaId_clienteId_key" ON "oferta_invitados"("ofertaId", "clienteId");

-- CreateIndex
CREATE INDEX "oferta_usos_invitadoId_createdAt_idx" ON "oferta_usos"("invitadoId", "createdAt");

-- CreateIndex
CREATE INDEX "oferta_usos_companyId_createdAt_idx" ON "oferta_usos"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "campanas_globales_estado_createdAt_idx" ON "campanas_globales"("estado", "createdAt");

-- CreateIndex
CREATE INDEX "campana_pasos_companyId_idx" ON "campana_pasos"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "campana_pasos_campanaId_orden_key" ON "campana_pasos"("campanaId", "orden");

-- CreateIndex
CREATE INDEX "campana_inscripciones_clienteId_idx" ON "campana_inscripciones"("clienteId");

-- CreateIndex
CREATE UNIQUE INDEX "campana_inscripciones_campanaId_clienteId_key" ON "campana_inscripciones"("campanaId", "clienteId");

-- CreateIndex
CREATE INDEX "campana_global_empresas_companyId_idx" ON "campana_global_empresas"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "campana_global_empresas_campanaId_companyId_key" ON "campana_global_empresas"("campanaId", "companyId");

-- CreateIndex
CREATE INDEX "cola_vehiculos_companyId_estado_createdAt_idx" ON "cola_vehiculos"("companyId", "estado", "createdAt");

-- CreateIndex
CREATE INDEX "productos_inventario_companyId_activo_idx" ON "productos_inventario"("companyId", "activo");

-- CreateIndex
CREATE INDEX "movimientos_inventario_productoId_createdAt_idx" ON "movimientos_inventario"("productoId", "createdAt");

-- CreateIndex
CREATE INDEX "movimientos_inventario_companyId_createdAt_idx" ON "movimientos_inventario"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "evidencias_foto_companyId_createdAt_idx" ON "evidencias_foto"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "evidencias_foto_colaId_idx" ON "evidencias_foto"("colaId");

-- CreateIndex
CREATE INDEX "tipos_vehiculo_companyId_activo_orden_idx" ON "tipos_vehiculo"("companyId", "activo", "orden");

-- CreateIndex
CREATE UNIQUE INDEX "tipos_vehiculo_companyId_nombre_key" ON "tipos_vehiculo"("companyId", "nombre");

-- CreateIndex
CREATE INDEX "servicios_companyId_activo_orden_idx" ON "servicios"("companyId", "activo", "orden");

-- CreateIndex
CREATE UNIQUE INDEX "servicios_companyId_nombre_key" ON "servicios"("companyId", "nombre");

-- CreateIndex
CREATE INDEX "servicio_precios_tipoVehiculoId_idx" ON "servicio_precios"("tipoVehiculoId");

-- CreateIndex
CREATE UNIQUE INDEX "servicio_precios_servicioId_tipoVehiculoId_key" ON "servicio_precios"("servicioId", "tipoVehiculoId");

-- CreateIndex
CREATE INDEX "bahias_companyId_activa_orden_idx" ON "bahias"("companyId", "activa", "orden");

-- CreateIndex
CREATE UNIQUE INDEX "bahias_companyId_nombre_key" ON "bahias"("companyId", "nombre");

-- CreateIndex
CREATE INDEX "cola_servicios_colaId_idx" ON "cola_servicios"("colaId");

-- CreateIndex
CREATE INDEX "cola_servicios_servicioId_idx" ON "cola_servicios"("servicioId");

-- CreateIndex
CREATE INDEX "cuentas_corporativas_companyId_activa_idx" ON "cuentas_corporativas"("companyId", "activa");

-- CreateIndex
CREATE UNIQUE INDEX "cuentas_corporativas_companyId_nombre_key" ON "cuentas_corporativas"("companyId", "nombre");

-- CreateIndex
CREATE INDEX "cuenta_vehiculos_placa_idx" ON "cuenta_vehiculos"("placa");

-- CreateIndex
CREATE UNIQUE INDEX "cuenta_vehiculos_cuentaId_placa_key" ON "cuenta_vehiculos"("cuentaId", "placa");

-- CreateIndex
CREATE INDEX "cargos_cuenta_cuentaId_estado_createdAt_idx" ON "cargos_cuenta"("cuentaId", "estado", "createdAt");

-- CreateIndex
CREATE INDEX "cargos_cuenta_corteRef_idx" ON "cargos_cuenta"("corteRef");

-- CreateIndex
CREATE INDEX "cargos_cuenta_colaId_idx" ON "cargos_cuenta"("colaId");

-- CreateIndex
CREATE INDEX "comisiones_companyId_estado_createdAt_idx" ON "comisiones"("companyId", "estado", "createdAt");

-- CreateIndex
CREATE INDEX "comisiones_userId_estado_idx" ON "comisiones"("userId", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "comisiones_colaId_userId_key" ON "comisiones"("colaId", "userId");

-- CreateIndex
CREATE INDEX "incidencias_companyId_estado_createdAt_idx" ON "incidencias"("companyId", "estado", "createdAt");

-- CreateIndex
CREATE INDEX "incidencias_companyId_tipo_createdAt_idx" ON "incidencias"("companyId", "tipo", "createdAt");

-- CreateIndex
CREATE INDEX "incidencias_colaId_idx" ON "incidencias"("colaId");

-- CreateIndex
CREATE INDEX "proveedores_companyId_activo_idx" ON "proveedores"("companyId", "activo");

-- CreateIndex
CREATE UNIQUE INDEX "proveedores_companyId_nombre_key" ON "proveedores"("companyId", "nombre");

-- CreateIndex
CREATE INDEX "ordenes_compra_companyId_estado_createdAt_idx" ON "ordenes_compra"("companyId", "estado", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ordenes_compra_companyId_numero_key" ON "ordenes_compra"("companyId", "numero");

-- CreateIndex
CREATE INDEX "orden_compra_lineas_ordenId_idx" ON "orden_compra_lineas"("ordenId");

-- CreateIndex
CREATE INDEX "orden_compra_lineas_productoId_idx" ON "orden_compra_lineas"("productoId");

-- CreateIndex
CREATE INDEX "activos_companyId_activo_estado_idx" ON "activos"("companyId", "activo", "estado");

-- CreateIndex
CREATE INDEX "mantenimientos_activoId_realizadoAt_idx" ON "mantenimientos"("activoId", "realizadoAt");

-- CreateIndex
CREATE INDEX "turnos_companyId_entradaAt_idx" ON "turnos"("companyId", "entradaAt");

-- CreateIndex
CREATE INDEX "turnos_userId_salidaAt_idx" ON "turnos"("userId", "salidaAt");

-- CreateIndex
CREATE UNIQUE INDEX "agenda_configs_companyId_key" ON "agenda_configs"("companyId");

-- CreateIndex
CREATE INDEX "citas_companyId_inicio_idx" ON "citas"("companyId", "inicio");

-- CreateIndex
CREATE INDEX "citas_clienteId_inicio_idx" ON "citas"("clienteId", "inicio");

-- CreateIndex
CREATE INDEX "citas_compraId_idx" ON "citas"("compraId");

-- CreateIndex
CREATE UNIQUE INDEX "invitaciones_token_key" ON "invitaciones"("token");

-- CreateIndex
CREATE INDEX "invitaciones_companyId_estado_idx" ON "invitaciones"("companyId", "estado");

-- CreateIndex
CREATE INDEX "invitaciones_email_idx" ON "invitaciones"("email");

-- CreateIndex
CREATE UNIQUE INDEX "clientes_codigoReferido_key" ON "clientes"("codigoReferido");

-- CreateIndex
CREATE UNIQUE INDEX "clientes_codigoCorto_key" ON "clientes"("codigoCorto");

-- CreateIndex
CREATE INDEX "clientes_companyId_idx" ON "clientes"("companyId");

-- CreateIndex
CREATE INDEX "clientes_companyId_canalOrigen_idx" ON "clientes"("companyId", "canalOrigen");

-- CreateIndex
CREATE UNIQUE INDEX "clientes_supabaseId_companyId_key" ON "clientes"("supabaseId", "companyId");

-- CreateIndex
CREATE INDEX "vehiculos_clienteId_idx" ON "vehiculos"("clienteId");

-- CreateIndex
CREATE INDEX "vehiculos_clienteId_esPrincipal_idx" ON "vehiculos"("clienteId", "esPrincipal");

-- CreateIndex
CREATE INDEX "vehiculos_pais_placaNormalizada_idx" ON "vehiculos"("pais", "placaNormalizada");

-- CreateIndex
CREATE INDEX "cliente_notas_clienteId_createdAt_idx" ON "cliente_notas"("clienteId", "createdAt");

-- CreateIndex
CREATE INDEX "user_intereses_categoryId_idx" ON "user_intereses"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "user_intereses_userId_categoryId_key" ON "user_intereses"("userId", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "users_supabaseId_key" ON "users"("supabaseId");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_companyId_idx" ON "users"("companyId");

-- CreateIndex
CREATE INDEX "user_company_access_companyId_idx" ON "user_company_access"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "user_company_access_userId_companyId_key" ON "user_company_access"("userId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "companies_slug_key" ON "companies"("slug");

-- CreateIndex
CREATE INDEX "companies_isPublished_isFeatured_idx" ON "companies"("isPublished", "isFeatured");

-- CreateIndex
CREATE INDEX "companies_ciudad_provincia_idx" ON "companies"("ciudad", "provincia");

-- CreateIndex
CREATE INDEX "companies_type_idx" ON "companies"("type");

-- CreateIndex
CREATE INDEX "companies_createdAt_idx" ON "companies"("createdAt");

-- CreateIndex
CREATE INDEX "sucursales_companyId_idx" ON "sucursales"("companyId");

-- CreateIndex
CREATE INDEX "audit_logs_companyId_idx" ON "audit_logs"("companyId");

-- CreateIndex
CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_accion_idx" ON "audit_logs"("accion");

-- CreateIndex
CREATE INDEX "audit_logs_entidadTipo_entidadId_idx" ON "audit_logs"("entidadTipo", "entidadId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "notificaciones_userId_leida_idx" ON "notificaciones"("userId", "leida");

-- CreateIndex
CREATE INDEX "notificaciones_userId_createdAt_idx" ON "notificaciones"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "sistemas_conectados_slug_key" ON "sistemas_conectados"("slug");

-- CreateIndex
CREATE INDEX "eventos_salientes_estado_createdAt_idx" ON "eventos_salientes"("estado", "createdAt");

-- CreateIndex
CREATE INDEX "eventos_salientes_companyId_tipo_createdAt_idx" ON "eventos_salientes"("companyId", "tipo", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "business_categories_name_key" ON "business_categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "business_categories_slug_key" ON "business_categories"("slug");

-- CreateIndex
CREATE INDEX "business_categories_active_order_idx" ON "business_categories"("active", "order");

-- CreateIndex
CREATE INDEX "company_to_categories_companyId_idx" ON "company_to_categories"("companyId");

-- CreateIndex
CREATE INDEX "company_to_categories_categoryId_idx" ON "company_to_categories"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "company_to_categories_companyId_categoryId_key" ON "company_to_categories"("companyId", "categoryId");

-- CreateIndex
CREATE INDEX "company_ratings_companyId_idx" ON "company_ratings"("companyId");

-- CreateIndex
CREATE INDEX "company_ratings_rating_idx" ON "company_ratings"("rating");

-- CreateIndex
CREATE UNIQUE INDEX "company_ratings_companyId_clienteId_key" ON "company_ratings"("companyId", "clienteId");

-- CreateIndex
CREATE INDEX "company_follows_companyId_idx" ON "company_follows"("companyId");

-- CreateIndex
CREATE INDEX "company_follows_userId_esFavorita_idx" ON "company_follows"("userId", "esFavorita");

-- CreateIndex
CREATE UNIQUE INDEX "company_follows_userId_companyId_key" ON "company_follows"("userId", "companyId");

-- CreateIndex
CREATE INDEX "promociones_guardadas_userId_createdAt_idx" ON "promociones_guardadas"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "promociones_guardadas_promocionId_idx" ON "promociones_guardadas"("promocionId");

-- CreateIndex
CREATE UNIQUE INDEX "promociones_guardadas_userId_promocionId_key" ON "promociones_guardadas"("userId", "promocionId");

-- CreateIndex
CREATE INDEX "metodos_pago_companyId_idx" ON "metodos_pago"("companyId");

-- CreateIndex
CREATE INDEX "plans_companyId_idx" ON "plans"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_referencia_key" ON "memberships"("referencia");

-- CreateIndex
CREATE INDEX "memberships_estado_idx" ON "memberships"("estado");

-- CreateIndex
CREATE INDEX "memberships_clienteId_idx" ON "memberships"("clienteId");

-- CreateIndex
CREATE INDEX "memberships_companyId_idx" ON "memberships"("companyId");

-- CreateIndex
CREATE INDEX "memberships_planId_idx" ON "memberships"("planId");

-- CreateIndex
CREATE INDEX "memberships_companyId_estado_fechaVencimiento_idx" ON "memberships"("companyId", "estado", "fechaVencimiento");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_clienteId_companyId_key" ON "memberships"("clienteId", "companyId");

-- CreateIndex
CREATE INDEX "plan_precios_categoria_tipoVehiculoId_idx" ON "plan_precios_categoria"("tipoVehiculoId");

-- CreateIndex
CREATE UNIQUE INDEX "plan_precios_categoria_planId_tipoVehiculoId_key" ON "plan_precios_categoria"("planId", "tipoVehiculoId");

-- CreateIndex
CREATE INDEX "membresia_vehiculos_vehiculoId_idx" ON "membresia_vehiculos"("vehiculoId");

-- CreateIndex
CREATE UNIQUE INDEX "membresia_vehiculos_membershipId_vehiculoId_key" ON "membresia_vehiculos"("membershipId", "vehiculoId");

-- CreateIndex
CREATE INDEX "tarjetas_tokenizadas_clienteId_activa_idx" ON "tarjetas_tokenizadas"("clienteId", "activa");

-- CreateIndex
CREATE INDEX "tarjetas_tokenizadas_companyId_idx" ON "tarjetas_tokenizadas"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "qr_tokens_token_key" ON "qr_tokens"("token");

-- CreateIndex
CREATE INDEX "qr_tokens_clienteId_activo_idx" ON "qr_tokens"("clienteId", "activo");

-- CreateIndex
CREATE INDEX "qr_tokens_membresiaId_idx" ON "qr_tokens"("membresiaId");

-- CreateIndex
CREATE INDEX "qr_tokens_compraId_idx" ON "qr_tokens"("compraId");

-- CreateIndex
CREATE INDEX "qr_tokens_expiraAt_idx" ON "qr_tokens"("expiraAt");

-- CreateIndex
CREATE INDEX "visits_clienteId_idx" ON "visits"("clienteId");

-- CreateIndex
CREATE INDEX "visits_membershipId_idx" ON "visits"("membershipId");

-- CreateIndex
CREATE INDEX "visits_fechaVisita_idx" ON "visits"("fechaVisita");

-- CreateIndex
CREATE INDEX "visits_vehiculoId_idx" ON "visits"("vehiculoId");

-- CreateIndex
CREATE INDEX "visits_sucursalId_idx" ON "visits"("sucursalId");

-- CreateIndex
CREATE INDEX "visits_membershipId_fechaVisita_idx" ON "visits"("membershipId", "fechaVisita");

-- CreateIndex
CREATE INDEX "visits_clienteId_fechaVisita_idx" ON "visits"("clienteId", "fechaVisita");

-- CreateIndex
CREATE UNIQUE INDEX "comprobantes_visitId_key" ON "comprobantes"("visitId");

-- CreateIndex
CREATE UNIQUE INDEX "comprobantes_numero_key" ON "comprobantes"("numero");

-- CreateIndex
CREATE INDEX "comprobantes_membershipId_idx" ON "comprobantes"("membershipId");

-- CreateIndex
CREATE INDEX "rule_groups_companyId_activo_idx" ON "rule_groups"("companyId", "activo");

-- CreateIndex
CREATE UNIQUE INDEX "rule_groups_companyId_key_key" ON "rule_groups"("companyId", "key");

-- CreateIndex
CREATE INDEX "rules_companyId_status_activo_idx" ON "rules"("companyId", "status", "activo");

-- CreateIndex
CREATE INDEX "rules_groupId_idx" ON "rules"("groupId");

-- CreateIndex
CREATE INDEX "rules_companyId_prioridad_idx" ON "rules"("companyId", "prioridad");

-- CreateIndex
CREATE INDEX "rule_conditions_ruleId_orden_idx" ON "rule_conditions"("ruleId", "orden");

-- CreateIndex
CREATE INDEX "rule_conditions_groupId_idx" ON "rule_conditions"("groupId");

-- CreateIndex
CREATE INDEX "rule_condition_groups_ruleId_idx" ON "rule_condition_groups"("ruleId");

-- CreateIndex
CREATE INDEX "rule_condition_groups_parentId_idx" ON "rule_condition_groups"("parentId");

-- CreateIndex
CREATE INDEX "rule_actions_ruleId_orden_idx" ON "rule_actions"("ruleId", "orden");

-- CreateIndex
CREATE INDEX "rule_execution_logs_companyId_createdAt_idx" ON "rule_execution_logs"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "rule_execution_logs_ruleId_idx" ON "rule_execution_logs"("ruleId");

-- CreateIndex
CREATE INDEX "promotions_companyId_status_idx" ON "promotions"("companyId", "status");

-- CreateIndex
CREATE INDEX "promotions_companyId_prioridad_idx" ON "promotions"("companyId", "prioridad");

-- CreateIndex
CREATE INDEX "promotions_companyId_status_inicioEn_finEn_idx" ON "promotions"("companyId", "status", "inicioEn", "finEn");

-- CreateIndex
CREATE INDEX "promotion_rules_ruleId_idx" ON "promotion_rules"("ruleId");

-- CreateIndex
CREATE UNIQUE INDEX "promotion_rules_promotionId_ruleId_key" ON "promotion_rules"("promotionId", "ruleId");

-- CreateIndex
CREATE INDEX "promotion_actions_promotionId_orden_idx" ON "promotion_actions"("promotionId", "orden");

-- CreateIndex
CREATE INDEX "promotion_restrictions_promotionId_idx" ON "promotion_restrictions"("promotionId");

-- CreateIndex
CREATE INDEX "promotion_versions_promotionId_idx" ON "promotion_versions"("promotionId");

-- CreateIndex
CREATE UNIQUE INDEX "promotion_versions_promotionId_version_key" ON "promotion_versions"("promotionId", "version");

-- CreateIndex
CREATE INDEX "promotion_audits_promotionId_createdAt_idx" ON "promotion_audits"("promotionId", "createdAt");

-- CreateIndex
CREATE INDEX "promotion_audits_companyId_createdAt_idx" ON "promotion_audits"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "data_dictionary_variables_companyId_category_idx" ON "data_dictionary_variables"("companyId", "category");

-- CreateIndex
CREATE INDEX "data_dictionary_variables_category_idx" ON "data_dictionary_variables"("category");

-- CreateIndex
CREATE INDEX "data_dictionary_variables_status_idx" ON "data_dictionary_variables"("status");

-- CreateIndex
CREATE UNIQUE INDEX "data_dictionary_variables_companyId_key_key" ON "data_dictionary_variables"("companyId", "key");

-- CreateIndex
CREATE INDEX "data_dictionary_variable_versions_variableId_idx" ON "data_dictionary_variable_versions"("variableId");

-- CreateIndex
CREATE UNIQUE INDEX "data_dictionary_variable_versions_variableId_version_key" ON "data_dictionary_variable_versions"("variableId", "version");

-- CreateIndex
CREATE INDEX "membership_plans_companyId_tipo_idx" ON "membership_plans"("companyId", "tipo");

-- CreateIndex
CREATE INDEX "membership_plans_companyId_status_idx" ON "membership_plans"("companyId", "status");

-- CreateIndex
CREATE INDEX "membership_instances_companyId_status_idx" ON "membership_instances"("companyId", "status");

-- CreateIndex
CREATE INDEX "membership_instances_planId_idx" ON "membership_instances"("planId");

-- CreateIndex
CREATE INDEX "membership_instances_subscriberId_idx" ON "membership_instances"("subscriberId");

-- CreateIndex
CREATE INDEX "membership_usage_instanceId_usadoEn_idx" ON "membership_usage"("instanceId", "usadoEn");

-- CreateIndex
CREATE INDEX "membership_usage_companyId_usadoEn_idx" ON "membership_usage"("companyId", "usadoEn");

-- CreateIndex
CREATE INDEX "benefits_companyId_status_idx" ON "benefits"("companyId", "status");

-- CreateIndex
CREATE INDEX "benefits_companyId_categoria_idx" ON "benefits"("companyId", "categoria");

-- CreateIndex
CREATE INDEX "benefits_companyId_tipo_idx" ON "benefits"("companyId", "tipo");

-- CreateIndex
CREATE INDEX "benefit_grants_companyId_status_idx" ON "benefit_grants"("companyId", "status");

-- CreateIndex
CREATE INDEX "benefit_grants_benefitId_status_idx" ON "benefit_grants"("benefitId", "status");

-- CreateIndex
CREATE INDEX "benefit_grants_subscriberId_idx" ON "benefit_grants"("subscriberId");

-- CreateIndex
CREATE INDEX "benefit_grants_companyId_sourceModule_idx" ON "benefit_grants"("companyId", "sourceModule");

-- CreateIndex
CREATE INDEX "benefit_transformations_companyId_status_idx" ON "benefit_transformations"("companyId", "status");

-- CreateIndex
CREATE INDEX "benefit_transformations_companyId_type_idx" ON "benefit_transformations"("companyId", "type");

-- CreateIndex
CREATE INDEX "benefit_transformations_subscriberId_idx" ON "benefit_transformations"("subscriberId");

-- CreateIndex
CREATE INDEX "benefit_transformations_sourceBenefitId_idx" ON "benefit_transformations"("sourceBenefitId");

-- CreateIndex
CREATE INDEX "benefit_transformations_targetBenefitId_idx" ON "benefit_transformations"("targetBenefitId");

-- CreateIndex
CREATE INDEX "transformation_policies_companyId_tipo_activa_idx" ON "transformation_policies"("companyId", "tipo", "activa");

-- CreateIndex
CREATE INDEX "referral_programs_companyId_status_idx" ON "referral_programs"("companyId", "status");

-- CreateIndex
CREATE INDEX "referral_programs_companyId_type_idx" ON "referral_programs"("companyId", "type");

-- CreateIndex
CREATE INDEX "referral_participants_companyId_programId_idx" ON "referral_participants"("companyId", "programId");

-- CreateIndex
CREATE INDEX "referral_participants_referrerId_idx" ON "referral_participants"("referrerId");

-- CreateIndex
CREATE UNIQUE INDEX "referral_participants_programId_code_key" ON "referral_participants"("programId", "code");

-- CreateIndex
CREATE INDEX "referral_referrals_companyId_programId_state_idx" ON "referral_referrals"("companyId", "programId", "state");

-- CreateIndex
CREATE INDEX "referral_referrals_participantId_state_idx" ON "referral_referrals"("participantId", "state");

-- CreateIndex
CREATE INDEX "referral_referrals_referredId_idx" ON "referral_referrals"("referredId");

-- CreateIndex
CREATE INDEX "automations_companyId_status_idx" ON "automations"("companyId", "status");

-- CreateIndex
CREATE INDEX "automations_companyId_triggerType_idx" ON "automations"("companyId", "triggerType");

-- CreateIndex
CREATE INDEX "automations_companyId_triggerEvent_idx" ON "automations"("companyId", "triggerEvent");

-- CreateIndex
CREATE INDEX "automation_runs_companyId_automationId_status_idx" ON "automation_runs"("companyId", "automationId", "status");

-- CreateIndex
CREATE INDEX "automation_runs_companyId_startedAt_idx" ON "automation_runs"("companyId", "startedAt");

-- CreateIndex
CREATE INDEX "automation_runs_subjectId_idx" ON "automation_runs"("subjectId");

-- CreateIndex
CREATE INDEX "automation_events_companyId_type_processed_idx" ON "automation_events"("companyId", "type", "processed");

-- CreateIndex
CREATE INDEX "automation_events_companyId_occurredAt_idx" ON "automation_events"("companyId", "occurredAt");

-- CreateIndex
CREATE INDEX "automation_events_subjectId_idx" ON "automation_events"("subjectId");

-- CreateIndex
CREATE INDEX "pago_intentos_companyId_estado_createdAt_idx" ON "pago_intentos"("companyId", "estado", "createdAt");

-- CreateIndex
CREATE INDEX "pago_intentos_referenciaExterna_idx" ON "pago_intentos"("referenciaExterna");

-- CreateIndex
CREATE INDEX "pago_intentos_compraId_idx" ON "pago_intentos"("compraId");

-- CreateIndex
CREATE INDEX "pago_intentos_membershipId_idx" ON "pago_intentos"("membershipId");

-- CreateIndex
CREATE INDEX "promociones_companyId_activo_idx" ON "promociones"("companyId", "activo");

-- CreateIndex
CREATE INDEX "promociones_isFeatured_vigenciaHasta_idx" ON "promociones"("isFeatured", "vigenciaHasta");

-- CreateIndex
CREATE INDEX "promociones_tipo_idx" ON "promociones"("tipo");

-- CreateIndex
CREATE INDEX "promociones_createdAt_idx" ON "promociones"("createdAt");

-- CreateIndex
CREATE INDEX "promociones_activo_archivada_visibilidad_publicadaEn_idx" ON "promociones"("activo", "archivada", "visibilidad", "publicadaEn");

-- CreateIndex
CREATE UNIQUE INDEX "promociones_companyId_slug_key" ON "promociones"("companyId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "producto_compras_referencia_key" ON "producto_compras"("referencia");

-- CreateIndex
CREATE INDEX "producto_compras_companyId_estado_idx" ON "producto_compras"("companyId", "estado");

-- CreateIndex
CREATE INDEX "producto_compras_clienteId_estado_idx" ON "producto_compras"("clienteId", "estado");

-- CreateIndex
CREATE INDEX "producto_compras_promocionId_estado_idx" ON "producto_compras"("promocionId", "estado");

-- CreateIndex
CREATE INDEX "producto_compras_companyId_createdAt_idx" ON "producto_compras"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "producto_compra_transiciones_compraId_createdAt_idx" ON "producto_compra_transiciones"("compraId", "createdAt");

-- CreateIndex
CREATE INDEX "company_posts_companyId_tipo_activo_idx" ON "company_posts"("companyId", "tipo", "activo");

-- CreateIndex
CREATE INDEX "company_posts_tipo_fechaEvento_idx" ON "company_posts"("tipo", "fechaEvento");

-- CreateIndex
CREATE INDEX "campanas_companyId_activo_idx" ON "campanas"("companyId", "activo");

-- CreateIndex
CREATE INDEX "referral_events_clienteId_companyId_idx" ON "referral_events"("clienteId", "companyId");

-- CreateIndex
CREATE INDEX "referral_events_companyId_tipo_createdAt_idx" ON "referral_events"("companyId", "tipo", "createdAt");

-- CreateIndex
CREATE INDEX "referral_events_companyId_tipo_visitorId_idx" ON "referral_events"("companyId", "tipo", "visitorId");

-- CreateIndex
CREATE INDEX "referral_events_referidoClienteId_idx" ON "referral_events"("referidoClienteId");

-- CreateIndex
CREATE INDEX "referral_events_growthLinkId_tipo_idx" ON "referral_events"("growthLinkId", "tipo");

-- CreateIndex
CREATE UNIQUE INDEX "referidos_referidoClienteId_key" ON "referidos"("referidoClienteId");

-- CreateIndex
CREATE INDEX "referidos_companyId_referenteClienteId_idx" ON "referidos"("companyId", "referenteClienteId");

-- CreateIndex
CREATE INDEX "referidos_companyId_sospechoso_idx" ON "referidos"("companyId", "sospechoso");

-- CreateIndex
CREATE INDEX "referidos_campanaInvitacionId_idx" ON "referidos"("campanaInvitacionId");

-- CreateIndex
CREATE INDEX "referral_recompensas_companyId_estado_idx" ON "referral_recompensas"("companyId", "estado");

-- CreateIndex
CREATE INDEX "referral_recompensas_referenteClienteId_idx" ON "referral_recompensas"("referenteClienteId");

-- CreateIndex
CREATE UNIQUE INDEX "referral_recompensas_referenteClienteId_reglaId_key" ON "referral_recompensas"("referenteClienteId", "reglaId");

-- CreateIndex
CREATE INDEX "reglas_recompensa_companyId_activo_idx" ON "reglas_recompensa"("companyId", "activo");

-- CreateIndex
CREATE UNIQUE INDEX "growth_links_code_key" ON "growth_links"("code");

-- CreateIndex
CREATE INDEX "growth_links_companyId_clienteId_idx" ON "growth_links"("companyId", "clienteId");

-- CreateIndex
CREATE INDEX "growth_links_campanaId_idx" ON "growth_links"("campanaId");

-- CreateIndex
CREATE UNIQUE INDEX "growth_configs_companyId_key" ON "growth_configs"("companyId");

-- CreateIndex
CREATE INDEX "growth_rules_companyId_activo_idx" ON "growth_rules"("companyId", "activo");

-- CreateIndex
CREATE INDEX "growth_rules_companyId_trigger_activo_idx" ON "growth_rules"("companyId", "trigger", "activo");

-- CreateIndex
CREATE UNIQUE INDEX "growth_rewards_dedupeKey_key" ON "growth_rewards"("dedupeKey");

-- CreateIndex
CREATE INDEX "growth_rewards_companyId_estado_idx" ON "growth_rewards"("companyId", "estado");

-- CreateIndex
CREATE INDEX "growth_rewards_clienteId_idx" ON "growth_rewards"("clienteId");

-- CreateIndex
CREATE INDEX "growth_rewards_growthLinkId_idx" ON "growth_rewards"("growthLinkId");

-- CreateIndex
CREATE INDEX "growth_wallets_companyId_idx" ON "growth_wallets"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "growth_wallets_companyId_clienteId_key" ON "growth_wallets"("companyId", "clienteId");

-- CreateIndex
CREATE UNIQUE INDEX "campanas_invitacion_slug_key" ON "campanas_invitacion"("slug");

-- CreateIndex
CREATE INDEX "campanas_invitacion_companyId_estado_idx" ON "campanas_invitacion"("companyId", "estado");

-- CreateIndex
CREATE INDEX "campanas_invitacion_estado_fechaFin_idx" ON "campanas_invitacion"("estado", "fechaFin");

-- CreateIndex
CREATE INDEX "invitacion_progresos_clienteId_idx" ON "invitacion_progresos"("clienteId");

-- CreateIndex
CREATE UNIQUE INDEX "invitacion_progresos_campanaId_clienteId_key" ON "invitacion_progresos"("campanaId", "clienteId");

-- CreateIndex
CREATE INDEX "invitacion_eventos_campanaId_tipo_idx" ON "invitacion_eventos"("campanaId", "tipo");

-- CreateIndex
CREATE INDEX "invitacion_eventos_campanaId_clienteId_idx" ON "invitacion_eventos"("campanaId", "clienteId");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_config_companyId_key" ON "whatsapp_config"("companyId");

-- CreateIndex
CREATE INDEX "faq_items_companyId_activo_idx" ON "faq_items"("companyId", "activo");

-- CreateIndex
CREATE INDEX "support_tickets_companyId_estado_idx" ON "support_tickets"("companyId", "estado");

-- CreateIndex
CREATE INDEX "support_tickets_clienteId_idx" ON "support_tickets"("clienteId");

-- CreateIndex
CREATE INDEX "ticket_mensajes_ticketId_idx" ON "ticket_mensajes"("ticketId");

-- AddForeignKey
ALTER TABLE "caja_sesiones" ADD CONSTRAINT "caja_sesiones_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caja_sesiones" ADD CONSTRAINT "caja_sesiones_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "sucursales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caja_sesiones" ADD CONSTRAINT "caja_sesiones_abiertaPorId_fkey" FOREIGN KEY ("abiertaPorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caja_sesiones" ADD CONSTRAINT "caja_sesiones_cerradaPorId_fkey" FOREIGN KEY ("cerradaPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_caja" ADD CONSTRAINT "movimientos_caja_cajaSesionId_fkey" FOREIGN KEY ("cajaSesionId") REFERENCES "caja_sesiones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regalos" ADD CONSTRAINT "regalos_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regalos" ADD CONSTRAINT "regalos_remitenteId_fkey" FOREIGN KEY ("remitenteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regalos" ADD CONSTRAINT "regalos_destinatarioId_fkey" FOREIGN KEY ("destinatarioId") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "sucursales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_empleadoId_fkey" FOREIGN KEY ("empleadoId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_cajaSesionId_fkey" FOREIGN KEY ("cajaSesionId") REFERENCES "caja_sesiones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_qrTokenUsadoId_fkey" FOREIGN KEY ("qrTokenUsadoId") REFERENCES "qr_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_transitions" ADD CONSTRAINT "transaction_transitions_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_transitions" ADD CONSTRAINT "transaction_transitions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_prints" ADD CONSTRAINT "receipt_prints_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_prints" ADD CONSTRAINT "receipt_prints_empleadoId_fkey" FOREIGN KEY ("empleadoId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_templates" ADD CONSTRAINT "receipt_templates_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_campaigns" ADD CONSTRAINT "marketing_campaigns_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ruleta_premios" ADD CONSTRAINT "ruleta_premios_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ruleta_premios" ADD CONSTRAINT "ruleta_premios_promocionId_fkey" FOREIGN KEY ("promocionId") REFERENCES "promociones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ruleta_jugadas" ADD CONSTRAINT "ruleta_jugadas_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ruleta_jugadas" ADD CONSTRAINT "ruleta_jugadas_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ruleta_jugadas" ADD CONSTRAINT "ruleta_jugadas_premioId_fkey" FOREIGN KEY ("premioId") REFERENCES "ruleta_premios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ofertas_privadas" ADD CONSTRAINT "ofertas_privadas_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ofertas_privadas" ADD CONSTRAINT "ofertas_privadas_creadaPorId_fkey" FOREIGN KEY ("creadaPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oferta_invitados" ADD CONSTRAINT "oferta_invitados_ofertaId_fkey" FOREIGN KEY ("ofertaId") REFERENCES "ofertas_privadas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oferta_invitados" ADD CONSTRAINT "oferta_invitados_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oferta_usos" ADD CONSTRAINT "oferta_usos_invitadoId_fkey" FOREIGN KEY ("invitadoId") REFERENCES "oferta_invitados"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oferta_usos" ADD CONSTRAINT "oferta_usos_registradoPorId_fkey" FOREIGN KEY ("registradoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campanas_globales" ADD CONSTRAINT "campanas_globales_creadaPorId_fkey" FOREIGN KEY ("creadaPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campana_pasos" ADD CONSTRAINT "campana_pasos_campanaId_fkey" FOREIGN KEY ("campanaId") REFERENCES "campanas_globales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campana_pasos" ADD CONSTRAINT "campana_pasos_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campana_inscripciones" ADD CONSTRAINT "campana_inscripciones_campanaId_fkey" FOREIGN KEY ("campanaId") REFERENCES "campanas_globales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campana_inscripciones" ADD CONSTRAINT "campana_inscripciones_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campana_global_empresas" ADD CONSTRAINT "campana_global_empresas_campanaId_fkey" FOREIGN KEY ("campanaId") REFERENCES "campanas_globales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campana_global_empresas" ADD CONSTRAINT "campana_global_empresas_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cola_vehiculos" ADD CONSTRAINT "cola_vehiculos_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cola_vehiculos" ADD CONSTRAINT "cola_vehiculos_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "sucursales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cola_vehiculos" ADD CONSTRAINT "cola_vehiculos_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cola_vehiculos" ADD CONSTRAINT "cola_vehiculos_vehiculoId_fkey" FOREIGN KEY ("vehiculoId") REFERENCES "vehiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cola_vehiculos" ADD CONSTRAINT "cola_vehiculos_registradaPorId_fkey" FOREIGN KEY ("registradaPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cola_vehiculos" ADD CONSTRAINT "cola_vehiculos_atendidoPorId_fkey" FOREIGN KEY ("atendidoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cola_vehiculos" ADD CONSTRAINT "cola_vehiculos_bahiaId_fkey" FOREIGN KEY ("bahiaId") REFERENCES "bahias"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cola_vehiculos" ADD CONSTRAINT "cola_vehiculos_tipoVehiculoId_fkey" FOREIGN KEY ("tipoVehiculoId") REFERENCES "tipos_vehiculo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productos_inventario" ADD CONSTRAINT "productos_inventario_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productos_inventario" ADD CONSTRAINT "productos_inventario_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "proveedores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "productos_inventario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_registradoPorId_fkey" FOREIGN KEY ("registradoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_ordenCompraId_fkey" FOREIGN KEY ("ordenCompraId") REFERENCES "ordenes_compra"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidencias_foto" ADD CONSTRAINT "evidencias_foto_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidencias_foto" ADD CONSTRAINT "evidencias_foto_colaId_fkey" FOREIGN KEY ("colaId") REFERENCES "cola_vehiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidencias_foto" ADD CONSTRAINT "evidencias_foto_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidencias_foto" ADD CONSTRAINT "evidencias_foto_vehiculoId_fkey" FOREIGN KEY ("vehiculoId") REFERENCES "vehiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidencias_foto" ADD CONSTRAINT "evidencias_foto_subidaPorId_fkey" FOREIGN KEY ("subidaPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tipos_vehiculo" ADD CONSTRAINT "tipos_vehiculo_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servicios" ADD CONSTRAINT "servicios_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servicio_precios" ADD CONSTRAINT "servicio_precios_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "servicios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servicio_precios" ADD CONSTRAINT "servicio_precios_tipoVehiculoId_fkey" FOREIGN KEY ("tipoVehiculoId") REFERENCES "tipos_vehiculo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bahias" ADD CONSTRAINT "bahias_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bahias" ADD CONSTRAINT "bahias_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "sucursales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cola_servicios" ADD CONSTRAINT "cola_servicios_colaId_fkey" FOREIGN KEY ("colaId") REFERENCES "cola_vehiculos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cola_servicios" ADD CONSTRAINT "cola_servicios_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "servicios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cuentas_corporativas" ADD CONSTRAINT "cuentas_corporativas_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cuenta_vehiculos" ADD CONSTRAINT "cuenta_vehiculos_cuentaId_fkey" FOREIGN KEY ("cuentaId") REFERENCES "cuentas_corporativas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cuenta_vehiculos" ADD CONSTRAINT "cuenta_vehiculos_vehiculoId_fkey" FOREIGN KEY ("vehiculoId") REFERENCES "vehiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cargos_cuenta" ADD CONSTRAINT "cargos_cuenta_cuentaId_fkey" FOREIGN KEY ("cuentaId") REFERENCES "cuentas_corporativas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cargos_cuenta" ADD CONSTRAINT "cargos_cuenta_colaId_fkey" FOREIGN KEY ("colaId") REFERENCES "cola_vehiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comisiones" ADD CONSTRAINT "comisiones_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comisiones" ADD CONSTRAINT "comisiones_colaId_fkey" FOREIGN KEY ("colaId") REFERENCES "cola_vehiculos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comisiones" ADD CONSTRAINT "comisiones_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidencias" ADD CONSTRAINT "incidencias_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidencias" ADD CONSTRAINT "incidencias_colaId_fkey" FOREIGN KEY ("colaId") REFERENCES "cola_vehiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidencias" ADD CONSTRAINT "incidencias_rewashColaId_fkey" FOREIGN KEY ("rewashColaId") REFERENCES "cola_vehiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidencias" ADD CONSTRAINT "incidencias_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidencias" ADD CONSTRAINT "incidencias_vehiculoId_fkey" FOREIGN KEY ("vehiculoId") REFERENCES "vehiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidencias" ADD CONSTRAINT "incidencias_reportadaPorId_fkey" FOREIGN KEY ("reportadaPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidencias" ADD CONSTRAINT "incidencias_responsableId_fkey" FOREIGN KEY ("responsableId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proveedores" ADD CONSTRAINT "proveedores_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordenes_compra" ADD CONSTRAINT "ordenes_compra_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordenes_compra" ADD CONSTRAINT "ordenes_compra_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "proveedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordenes_compra" ADD CONSTRAINT "ordenes_compra_creadaPorId_fkey" FOREIGN KEY ("creadaPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden_compra_lineas" ADD CONSTRAINT "orden_compra_lineas_ordenId_fkey" FOREIGN KEY ("ordenId") REFERENCES "ordenes_compra"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden_compra_lineas" ADD CONSTRAINT "orden_compra_lineas_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "productos_inventario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activos" ADD CONSTRAINT "activos_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mantenimientos" ADD CONSTRAINT "mantenimientos_activoId_fkey" FOREIGN KEY ("activoId") REFERENCES "activos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mantenimientos" ADD CONSTRAINT "mantenimientos_hechoPorId_fkey" FOREIGN KEY ("hechoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turnos" ADD CONSTRAINT "turnos_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turnos" ADD CONSTRAINT "turnos_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turnos" ADD CONSTRAINT "turnos_cerradoPorId_fkey" FOREIGN KEY ("cerradoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agenda_configs" ADD CONSTRAINT "agenda_configs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citas" ADD CONSTRAINT "citas_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citas" ADD CONSTRAINT "citas_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citas" ADD CONSTRAINT "citas_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "sucursales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citas" ADD CONSTRAINT "citas_vehiculoId_fkey" FOREIGN KEY ("vehiculoId") REFERENCES "vehiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citas" ADD CONSTRAINT "citas_atendidaPorId_fkey" FOREIGN KEY ("atendidaPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citas" ADD CONSTRAINT "citas_compraId_fkey" FOREIGN KEY ("compraId") REFERENCES "producto_compras"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitaciones" ADD CONSTRAINT "invitaciones_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehiculos" ADD CONSTRAINT "vehiculos_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehiculos" ADD CONSTRAINT "vehiculos_tipoVehiculoId_fkey" FOREIGN KEY ("tipoVehiculoId") REFERENCES "tipos_vehiculo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cliente_notas" ADD CONSTRAINT "cliente_notas_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cliente_notas" ADD CONSTRAINT "cliente_notas_autorId_fkey" FOREIGN KEY ("autorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_intereses" ADD CONSTRAINT "user_intereses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_intereses" ADD CONSTRAINT "user_intereses_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "business_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_company_access" ADD CONSTRAINT "user_company_access_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_company_access" ADD CONSTRAINT "user_company_access_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sucursales" ADD CONSTRAINT "sucursales_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificaciones" ADD CONSTRAINT "notificaciones_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos_salientes" ADD CONSTRAINT "eventos_salientes_sistemaId_fkey" FOREIGN KEY ("sistemaId") REFERENCES "sistemas_conectados"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_to_categories" ADD CONSTRAINT "company_to_categories_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_to_categories" ADD CONSTRAINT "company_to_categories_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "business_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_ratings" ADD CONSTRAINT "company_ratings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_ratings" ADD CONSTRAINT "company_ratings_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_follows" ADD CONSTRAINT "company_follows_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_follows" ADD CONSTRAINT "company_follows_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promociones_guardadas" ADD CONSTRAINT "promociones_guardadas_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promociones_guardadas" ADD CONSTRAINT "promociones_guardadas_promocionId_fkey" FOREIGN KEY ("promocionId") REFERENCES "promociones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metodos_pago" ADD CONSTRAINT "metodos_pago_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plans" ADD CONSTRAINT "plans_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_planIdSolicitado_fkey" FOREIGN KEY ("planIdSolicitado") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_metodoPagoId_fkey" FOREIGN KEY ("metodoPagoId") REFERENCES "metodos_pago"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_sucursalPagoId_fkey" FOREIGN KEY ("sucursalPagoId") REFERENCES "sucursales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tarjetaTokenizadaId_fkey" FOREIGN KEY ("tarjetaTokenizadaId") REFERENCES "tarjetas_tokenizadas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_precios_categoria" ADD CONSTRAINT "plan_precios_categoria_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_precios_categoria" ADD CONSTRAINT "plan_precios_categoria_tipoVehiculoId_fkey" FOREIGN KEY ("tipoVehiculoId") REFERENCES "tipos_vehiculo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membresia_vehiculos" ADD CONSTRAINT "membresia_vehiculos_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membresia_vehiculos" ADD CONSTRAINT "membresia_vehiculos_vehiculoId_fkey" FOREIGN KEY ("vehiculoId") REFERENCES "vehiculos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tarjetas_tokenizadas" ADD CONSTRAINT "tarjetas_tokenizadas_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tarjetas_tokenizadas" ADD CONSTRAINT "tarjetas_tokenizadas_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_tokens" ADD CONSTRAINT "qr_tokens_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_tokens" ADD CONSTRAINT "qr_tokens_membresiaId_fkey" FOREIGN KEY ("membresiaId") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_tokens" ADD CONSTRAINT "qr_tokens_compraId_fkey" FOREIGN KEY ("compraId") REFERENCES "producto_compras"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_vehiculoId_fkey" FOREIGN KEY ("vehiculoId") REFERENCES "vehiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "sucursales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_empleadoId_fkey" FOREIGN KEY ("empleadoId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_groups" ADD CONSTRAINT "rule_groups_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rules" ADD CONSTRAINT "rules_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rules" ADD CONSTRAINT "rules_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "rule_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_conditions" ADD CONSTRAINT "rule_conditions_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_conditions" ADD CONSTRAINT "rule_conditions_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "rule_condition_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_condition_groups" ADD CONSTRAINT "rule_condition_groups_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_condition_groups" ADD CONSTRAINT "rule_condition_groups_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "rule_condition_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_actions" ADD CONSTRAINT "rule_actions_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_execution_logs" ADD CONSTRAINT "rule_execution_logs_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_execution_logs" ADD CONSTRAINT "rule_execution_logs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_rules" ADD CONSTRAINT "promotion_rules_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_rules" ADD CONSTRAINT "promotion_rules_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_actions" ADD CONSTRAINT "promotion_actions_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_restrictions" ADD CONSTRAINT "promotion_restrictions_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_versions" ADD CONSTRAINT "promotion_versions_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_audits" ADD CONSTRAINT "promotion_audits_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_audits" ADD CONSTRAINT "promotion_audits_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_dictionary_variables" ADD CONSTRAINT "data_dictionary_variables_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_dictionary_variable_versions" ADD CONSTRAINT "data_dictionary_variable_versions_variableId_fkey" FOREIGN KEY ("variableId") REFERENCES "data_dictionary_variables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_plans" ADD CONSTRAINT "membership_plans_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_instances" ADD CONSTRAINT "membership_instances_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_instances" ADD CONSTRAINT "membership_instances_planId_fkey" FOREIGN KEY ("planId") REFERENCES "membership_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_usage" ADD CONSTRAINT "membership_usage_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "membership_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benefits" ADD CONSTRAINT "benefits_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benefit_grants" ADD CONSTRAINT "benefit_grants_benefitId_fkey" FOREIGN KEY ("benefitId") REFERENCES "benefits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benefit_transformations" ADD CONSTRAINT "benefit_transformations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benefit_transformations" ADD CONSTRAINT "benefit_transformations_sourceBenefitId_fkey" FOREIGN KEY ("sourceBenefitId") REFERENCES "benefits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benefit_transformations" ADD CONSTRAINT "benefit_transformations_targetBenefitId_fkey" FOREIGN KEY ("targetBenefitId") REFERENCES "benefits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transformation_policies" ADD CONSTRAINT "transformation_policies_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_programs" ADD CONSTRAINT "referral_programs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_participants" ADD CONSTRAINT "referral_participants_programId_fkey" FOREIGN KEY ("programId") REFERENCES "referral_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_referrals" ADD CONSTRAINT "referral_referrals_programId_fkey" FOREIGN KEY ("programId") REFERENCES "referral_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_referrals" ADD CONSTRAINT "referral_referrals_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "referral_participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automations" ADD CONSTRAINT "automations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "automations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pago_intentos" ADD CONSTRAINT "pago_intentos_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pago_intentos" ADD CONSTRAINT "pago_intentos_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pago_intentos" ADD CONSTRAINT "pago_intentos_compraId_fkey" FOREIGN KEY ("compraId") REFERENCES "producto_compras"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pago_intentos" ADD CONSTRAINT "pago_intentos_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promociones" ADD CONSTRAINT "promociones_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promociones" ADD CONSTRAINT "promociones_campanaId_fkey" FOREIGN KEY ("campanaId") REFERENCES "campanas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "producto_compras" ADD CONSTRAINT "producto_compras_campanaPasoId_fkey" FOREIGN KEY ("campanaPasoId") REFERENCES "campana_pasos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "producto_compras" ADD CONSTRAINT "producto_compras_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "producto_compras" ADD CONSTRAINT "producto_compras_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "producto_compras" ADD CONSTRAINT "producto_compras_promocionId_fkey" FOREIGN KEY ("promocionId") REFERENCES "promociones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "producto_compras" ADD CONSTRAINT "producto_compras_metodoPagoId_fkey" FOREIGN KEY ("metodoPagoId") REFERENCES "metodos_pago"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "producto_compras" ADD CONSTRAINT "producto_compras_aprobadaPorId_fkey" FOREIGN KEY ("aprobadaPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "producto_compras" ADD CONSTRAINT "producto_compras_sucursalPagoId_fkey" FOREIGN KEY ("sucursalPagoId") REFERENCES "sucursales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "producto_compra_transiciones" ADD CONSTRAINT "producto_compra_transiciones_compraId_fkey" FOREIGN KEY ("compraId") REFERENCES "producto_compras"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "producto_compra_transiciones" ADD CONSTRAINT "producto_compra_transiciones_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_posts" ADD CONSTRAINT "company_posts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_posts" ADD CONSTRAINT "company_posts_campanaId_fkey" FOREIGN KEY ("campanaId") REFERENCES "campanas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campanas" ADD CONSTRAINT "campanas_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_events" ADD CONSTRAINT "referral_events_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_events" ADD CONSTRAINT "referral_events_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_events" ADD CONSTRAINT "referral_events_growthLinkId_fkey" FOREIGN KEY ("growthLinkId") REFERENCES "growth_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referidos" ADD CONSTRAINT "referidos_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referidos" ADD CONSTRAINT "referidos_referenteClienteId_fkey" FOREIGN KEY ("referenteClienteId") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referidos" ADD CONSTRAINT "referidos_referidoClienteId_fkey" FOREIGN KEY ("referidoClienteId") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referidos" ADD CONSTRAINT "referidos_campanaInvitacionId_fkey" FOREIGN KEY ("campanaInvitacionId") REFERENCES "campanas_invitacion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_recompensas" ADD CONSTRAINT "referral_recompensas_reglaId_fkey" FOREIGN KEY ("reglaId") REFERENCES "reglas_recompensa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reglas_recompensa" ADD CONSTRAINT "reglas_recompensa_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_links" ADD CONSTRAINT "growth_links_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_links" ADD CONSTRAINT "growth_links_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_links" ADD CONSTRAINT "growth_links_promocionId_fkey" FOREIGN KEY ("promocionId") REFERENCES "promociones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_links" ADD CONSTRAINT "growth_links_campanaId_fkey" FOREIGN KEY ("campanaId") REFERENCES "campanas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_configs" ADD CONSTRAINT "growth_configs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_rules" ADD CONSTRAINT "growth_rules_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_rules" ADD CONSTRAINT "growth_rules_campanaId_fkey" FOREIGN KEY ("campanaId") REFERENCES "campanas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_rules" ADD CONSTRAINT "growth_rules_recompensaPromocionId_fkey" FOREIGN KEY ("recompensaPromocionId") REFERENCES "promociones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_rewards" ADD CONSTRAINT "growth_rewards_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "growth_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_rewards" ADD CONSTRAINT "growth_rewards_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_rewards" ADD CONSTRAINT "growth_rewards_growthLinkId_fkey" FOREIGN KEY ("growthLinkId") REFERENCES "growth_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_wallets" ADD CONSTRAINT "growth_wallets_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campanas_invitacion" ADD CONSTRAINT "campanas_invitacion_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitacion_progresos" ADD CONSTRAINT "invitacion_progresos_campanaId_fkey" FOREIGN KEY ("campanaId") REFERENCES "campanas_invitacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitacion_progresos" ADD CONSTRAINT "invitacion_progresos_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitacion_eventos" ADD CONSTRAINT "invitacion_eventos_campanaId_fkey" FOREIGN KEY ("campanaId") REFERENCES "campanas_invitacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitacion_eventos" ADD CONSTRAINT "invitacion_eventos_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_config" ADD CONSTRAINT "whatsapp_config_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faq_items" ADD CONSTRAINT "faq_items_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_mensajes" ADD CONSTRAINT "ticket_mensajes_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

