import { prisma } from '@/lib/prisma'
import { conEmpresa } from '@/lib/tenant'
import type { Prisma } from '@prisma/client'
import type {
  Lead,
  LeadFilter,
  LeadQueryResult,
  CrmStats,
  PaginacionParams,
} from './types'

// ── Helpers ────────────────────────────────────────────────────────────────

/** Cast Prisma lead (string enums) → branded Lead type. */
function toLead(row: Record<string, unknown>): Lead {
  return row as unknown as Lead
}

function buildLeadWhere(
  companyId: string,
  filtro: LeadFilter = {}
): Prisma.LeadWhereInput {
  const where: Prisma.LeadWhereInput = { companyId }

  if (filtro.q) {
    where.OR = [
      { nombre: { contains: filtro.q, mode: 'insensitive' } },
      { email: { contains: filtro.q, mode: 'insensitive' } },
      { telefono: { contains: filtro.q, mode: 'insensitive' } },
    ]
  }
  if (filtro.estado) where.estado = filtro.estado
  if (filtro.etapa) where.etapa = filtro.etapa
  if (filtro.prioridad) where.prioridad = filtro.prioridad
  if (filtro.fuente) where.fuente = filtro.fuente
  if (filtro.canal) where.canal = filtro.canal
  if (filtro.asignadoA) where.asignadoA = filtro.asignadoA

  if (filtro.desde || filtro.hasta) {
    where.createdAt = {}
    if (filtro.desde) where.createdAt.gte = new Date(filtro.desde)
    if (filtro.hasta) where.createdAt.lte = new Date(filtro.hasta)
  }

  return where
}

// ── Queries ────────────────────────────────────────────────────────────────

/**
 * Lista leads de una empresa con filtros, paginación y ordenamiento.
 */
export async function getLeads(
  companyId: string,
  filtro: LeadFilter = {},
  paginacion: PaginacionParams = {}
): Promise<LeadQueryResult> {
  const pagina = Math.max(1, paginacion.pagina ?? 1)
  const porPagina = Math.min(100, Math.max(1, paginacion.porPagina ?? 20))
  const skip = (pagina - 1) * porPagina

  const where = buildLeadWhere(companyId, filtro)

  const [leads, total] = await Promise.all([
    conEmpresa(companyId, (tx) =>
      tx.lead.findMany({
        where,
        orderBy: [{ prioridad: 'asc' }, { createdAt: 'desc' }],
        skip,
        take: porPagina,
      })
    ),
    conEmpresa(companyId, (tx) => tx.lead.count({ where })),
  ])

  return {
    leads: leads.map(toLead),
    total,
    pagina,
    porPagina,
    totalPaginas: Math.ceil(total / porPagina),
  }
}

/**
 * Obtiene un lead por ID, verificando que pertenezca a la empresa.
 */
export async function getLeadById(
  companyId: string,
  leadId: string
): Promise<Lead | null> {
  const row = await conEmpresa(companyId, (tx) =>
    tx.lead.findFirst({
      where: { id: leadId, companyId },
      include: { notasSeguimiento: { orderBy: { createdAt: 'desc' } } },
    })
  )
  return row ? toLead(row as Record<string, unknown>) : null
}

/**
 * Estadísticas del CRM para el dashboard.
 */
export async function getStats(companyId: string): Promise<CrmStats> {
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)

  const [totalLeads, leadsPorEtapa, leadsPorEstado, leadsPorPrioridad, leadsNuevosHoy, seguimientosPendientes] =
    await conEmpresa(companyId, async (tx) => {
      const total = await tx.lead.count({ where: { companyId } })

      const porEtapa = await tx.lead.groupBy({
        by: ['etapa'],
        where: { companyId },
        _count: { _all: true },
      })

      const porEstado = await tx.lead.groupBy({
        by: ['estado'],
        where: { companyId },
        _count: { _all: true },
      })

      const porPrioridad = await tx.lead.groupBy({
        by: ['prioridad'],
        where: { companyId },
        _count: { _all: true },
      })

      const nuevosHoy = await tx.lead.count({
        where: { companyId, createdAt: { gte: hoy } },
      })

      const pendientes = await tx.lead.count({
        where: {
          companyId,
          fechaSeguimiento: { lte: new Date() },
          estado: { notIn: ['CONVERTIDO', 'DESCARTADO'] },
        },
      })

      return [total, porEtapa, porEstado, porPrioridad, nuevosHoy, pendientes]
    })

  const etapaMap: Record<string, number> = {}
  for (const row of leadsPorEtapa) {
    etapaMap[row.etapa] = row._count._all
  }

  const estadoMap: Record<string, number> = {}
  for (const row of leadsPorEstado) {
    estadoMap[row.estado] = row._count._all
  }

  const prioridadMap: Record<string, number> = {}
  for (const row of leadsPorPrioridad) {
    prioridadMap[row.prioridad] = row._count._all
  }

  return {
    totalLeads,
    leadsPorEtapa: etapaMap as CrmStats['leadsPorEtapa'],
    leadsPorEstado: estadoMap as CrmStats['leadsPorEstado'],
    leadsPorPrioridad: prioridadMap as CrmStats['leadsPorPrioridad'],
    leadsNuevosHoy,
    seguimientosPendientes,
  }
}

/**
 * Configuración del pipeline para una empresa.
 */
export async function getPipelineConfig(companyId: string) {
  return prisma.pipelineConfig.findUnique({
    where: { companyId },
  })
}

export interface PipelineConfigData {
  id: string
  companyId: string
  stages: StageConfig[]
  camposCustom: CampoConfig[]
  automatizaciones: AutomatizacionesConfig
  updatedAt: Date
}

export interface StageConfig {
  id: string
  nombre: string
  color: string
}

export interface CampoConfig {
  key: string
  label: string
  tipo: 'text' | 'select' | 'number' | 'date'
  opciones: string[]
  obligatorio?: boolean
}

export interface AutomatizacionesConfig {
  bienvenida: boolean
  recordatorio: boolean
  recordatorioDias: number
  cierre: boolean
}

const DEFAULT_STAGES_CONFIG: StageConfig[] = [
  { id: 's1', nombre: 'Nuevo', color: 'bg-info' },
  { id: 's2', nombre: 'Contactado', color: 'bg-pending' },
  { id: 's3', nombre: 'Cotización', color: 'bg-warning' },
  { id: 's4', nombre: 'Negociación', color: 'bg-primary' },
  { id: 's5', nombre: 'Cerrado', color: 'bg-success' },
]

const DEFAULT_CAMPOS_CONFIG: CampoConfig[] = [
  { key: 'fuente', label: 'Fuente del lead', tipo: 'select', opciones: ['WhatsApp', 'Instagram', 'Teléfono', 'Referido', 'Facebook', 'Walk-in'], obligatorio: false },
  { key: 'presupuesto', label: 'Presupuesto estimado', tipo: 'number', opciones: [], obligatorio: false },
  { key: 'tipoVehiculo', label: 'Tipo de vehículo', tipo: 'select', opciones: ['Sedán', 'SUV', 'Pickup', 'Van'], obligatorio: false },
  { key: 'frecuencia', label: 'Frecuencia deseada', tipo: 'select', opciones: ['Semanal', 'Quincenal', 'Mensual', 'Ocasional'], obligatorio: false },
]

const DEFAULT_AUTOMATIZACIONES_CONFIG: AutomatizacionesConfig = {
  bienvenida: true,
  recordatorio: true,
  recordatorioDias: 3,
  cierre: false,
}

export async function getOrCreatePipelineConfig(companyId: string): Promise<PipelineConfigData> {
  const existing = await prisma.pipelineConfig.findUnique({ where: { companyId } })
  if (existing) {
    return {
      id: existing.id,
      companyId: existing.companyId,
      stages: (existing.stages as unknown as StageConfig[]) ?? DEFAULT_STAGES_CONFIG,
      camposCustom: (existing.camposCustom as unknown as CampoConfig[]) ?? DEFAULT_CAMPOS_CONFIG,
      automatizaciones: (existing.automatizaciones as unknown as AutomatizacionesConfig) ?? DEFAULT_AUTOMATIZACIONES_CONFIG,
      updatedAt: existing.updatedAt,
    }
  }
  return {
    id: '',
    companyId,
    stages: DEFAULT_STAGES_CONFIG,
    camposCustom: DEFAULT_CAMPOS_CONFIG,
    automatizaciones: DEFAULT_AUTOMATIZACIONES_CONFIG,
    updatedAt: new Date(),
  }
}

// ── Métricas ──────────────────────────────────────────────────────────────

export interface MetricasGenerales {
  leadsHoy: number
  enPipeline: number
  ganadosMes: number
  tasaConversion: number
}

/**
 * Métricas generales del CRM: leads hoy, en pipeline, ganados este mes, tasa conversión.
 */
export async function getMetricas(companyId: string): Promise<MetricasGenerales> {
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)

  const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1)

  const [leadsHoy, enPipeline, ganadosMes, totalLeads] = await conEmpresa(companyId, async (tx) => {
    const hoyCount = await tx.lead.count({
      where: { companyId, createdAt: { gte: hoy } },
    })
    const pipeline = await tx.lead.count({
      where: {
        companyId,
        estado: 'ACTIVO',
        etapa: { notIn: ['GANADO', 'PERDIDO'] },
      },
    })
    const ganados = await tx.lead.count({
      where: {
        companyId,
        etapa: 'GANADO',
        updatedAt: { gte: inicioMes },
      },
    })
    const total = await tx.lead.count({ where: { companyId } })
    return [hoyCount, pipeline, ganados, total]
  })

  const tasaConversion = totalLeads > 0 ? Math.round((ganadosMes / totalLeads) * 100) : 0

  return { leadsHoy, enPipeline, ganadosMes, tasaConversion }
}

export interface LeadsPorFuente {
  fuente: string
  cantidad: number
  porcentaje: number
}

/**
 * Leads agrupados por fuente con porcentajes.
 */
export async function getLeadsPorFuente(companyId: string): Promise<LeadsPorFuente[]> {
  const [grupos, total] = await conEmpresa(companyId, async (tx) => {
    const g = await tx.lead.groupBy({
      by: ['fuente'],
      where: { companyId },
      _count: { _all: true },
    })
    const t = await tx.lead.count({ where: { companyId } })
    return [g, t]
  })

  return grupos
    .map((g) => ({
      fuente: g.fuente,
      cantidad: (g._count as { _all: number })._all,
      porcentaje: total > 0 ? Math.round(((g._count as { _all: number })._all / total) * 100) : 0,
    }))
    .sort((a, b) => b.cantidad - a.cantidad)
}

export interface TiempoPorEtapa {
  etapa: string
  dias: number
  diasFormateado: string
}

/**
 * Tiempo promedio entre etapas calculado a partir de las fechas de creación de leads por etapa.
 * Usa createdAt como referencia para estimar el tiempo promedio en cada etapa.
 */
export async function getTiempoPorEtapa(companyId: string): Promise<TiempoPorEtapa[]> {
  const ETAPAS = ['NUEVO', 'CONTACTADO', 'INTERESADO', 'PROPUESTA', 'NEGOCIACION', 'GANADO', 'PERDIDO']

  const leads = await conEmpresa(companyId, (tx) =>
    tx.lead.findMany({
      where: { companyId },
      select: { etapa: true, createdAt: true, updatedAt: true },
    })
  )

  // Agrupar leads por etapa actual y calcular tiempo promedio
  const porEtapa: Record<string, { total: number; count: number }> = {}
  for (const lead of leads) {
    if (!porEtapa[lead.etapa]) porEtapa[lead.etapa] = { total: 0, count: 0 }
    const diasEnEtapa = (Date.now() - lead.createdAt.getTime()) / (1000 * 60 * 60 * 24)
    porEtapa[lead.etapa].total += diasEnEtapa
    porEtapa[lead.etapa].count += 1
  }

  return ETAPAS.map((etapa) => {
    const data = porEtapa[etapa]
    const dias = data && data.count > 0 ? Math.round((data.total / data.count) * 10) / 10 : 0
    return {
      etapa,
      dias,
      diasFormateado: dias === 1 ? '1 día' : `${dias} días`,
    }
  })
}

export interface LeadsPorAsignado {
  asignadoA: string
  cantidad: number
}

/**
 * Leads agrupados por usuario asignado.
 */
export async function getLeadsPorAsignado(companyId: string): Promise<LeadsPorAsignado[]> {
  const grupos = await conEmpresa(companyId, (tx) =>
    tx.lead.groupBy({
      by: ['asignadoA'],
      where: { companyId, asignadoA: { not: null } },
      _count: { _all: true },
    })
  )

  return grupos
    .map((g) => ({
      asignadoA: g.asignadoA ?? 'Sin asignar',
      cantidad: (g._count as { _all: number })._all,
    }))
    .sort((a, b) => b.cantidad - a.cantidad)
}

export interface LeadAtencion {
  id: string
  nombre: string
  etapa: string
  fechaSeguimiento: Date | null
  diasEspera: number
}

/**
 * Leads que requieren atención: fechaSeguimiento pasada y estado activo.
 */
export async function getLeadsAtencion(companyId: string): Promise<LeadAtencion[]> {
  const leads = await conEmpresa(companyId, (tx) =>
    tx.lead.findMany({
      where: {
        companyId,
        estado: { in: ['ACTIVO', 'INACTIVO'] },
        fechaSeguimiento: { lte: new Date() },
      },
      select: {
        id: true,
        nombre: true,
        etapa: true,
        fechaSeguimiento: true,
        createdAt: true,
      },
      orderBy: { fechaSeguimiento: 'asc' },
      take: 10,
    })
  )

  return leads.map((l) => ({
    id: l.id,
    nombre: l.nombre,
    etapa: l.etapa,
    fechaSeguimiento: l.fechaSeguimiento,
    diasEspera: l.fechaSeguimiento
      ? Math.floor((Date.now() - l.fechaSeguimiento.getTime()) / (1000 * 60 * 60 * 24))
      : Math.floor((Date.now() - l.createdAt.getTime()) / (1000 * 60 * 60 * 24)),
  }))
}
