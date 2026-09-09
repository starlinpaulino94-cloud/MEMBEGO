import type { Prisma } from '@prisma/client'

// ── Lead ───────────────────────────────────────────────────────────────────

export type LeadFuente = 'ORGANICO' | 'PAGADO' | 'REFERENCIA' | 'EVENTO' | 'OTRO'
export type LeadCanal = 'WHATSAPP' | 'INSTAGRAM' | 'FACEBOOK' | 'TELEFONO' | 'PRESENCIAL' | 'WEB'
export type LeadEstado = 'ACTIVO' | 'INACTIVO' | 'CONVERTIDO' | 'DESCARTADO'
export type LeadEtapa =
  | 'NUEVO'
  | 'CONTACTADO'
  | 'INTERESADO'
  | 'PROPUESTA'
  | 'NEGOCIACION'
  | 'GANADO'
  | 'PERDIDO'
export type LeadPrioridad = 'BAJA' | 'MEDIA' | 'ALTA' | 'URGENTE'

export interface Lead {
  id: string
  companyId: string
  clienteId: string | null
  nombre: string
  email: string | null
  telefono: string | null
  fuente: LeadFuente
  canal: LeadCanal
  estado: LeadEstado
  etapa: LeadEtapa
  score: number | null
  fechaSeguimiento: Date | null
  prioridad: LeadPrioridad
  asignadoA: string | null
  notas: string | null
  tags: string[]
  createdAt: Date
  updatedAt: Date
}

export interface LeadCreateInput {
  companyId: string
  clienteId?: string | null
  nombre: string
  email?: string | null
  telefono?: string | null
  fuente?: LeadFuente
  canal?: LeadCanal
  estado?: LeadEstado
  etapa?: LeadEtapa
  score?: number | null
  fechaSeguimiento?: Date | null
  prioridad?: LeadPrioridad
  asignadoA?: string | null
  notas?: string | null
  tags?: string[]
}

export interface LeadUpdateInput {
  nombre?: string
  email?: string | null
  telefono?: string | null
  fuente?: LeadFuente
  canal?: LeadCanal
  estado?: LeadEstado
  etapa?: LeadEtapa
  score?: number | null
  fechaSeguimiento?: Date | null
  prioridad?: LeadPrioridad
  asignadoA?: string | null
  notas?: string | null
  tags?: string[]
}

// ── Nota de seguimiento ────────────────────────────────────────────────────

export type NotaTipo = 'NOTA' | 'LLAMADA' | 'EMAIL' | 'WHATSAPP' | 'REUNION'
export type NotaEstado = 'PENDIENTE' | 'COMPLETADA'

export interface NotaSeguimiento {
  id: string
  leadId: string
  userId: string
  contenido: string
  tipo: NotaTipo
  estado: NotaEstado
  fechaProxima: Date | null
  createdAt: Date
}

export interface NotaCreateInput {
  leadId: string
  userId: string
  contenido: string
  tipo?: NotaTipo
  fechaProxima?: Date | null
}

// ── Stats ──────────────────────────────────────────────────────────────────

export interface CrmStats {
  totalLeads: number
  leadsPorEtapa: Record<LeadEtapa, number>
  leadsPorEstado: Record<LeadEstado, number>
  leadsPorPrioridad: Record<LeadPrioridad, number>
  leadsNuevosHoy: number
  seguimientosPendientes: number
}

// ── Pipeline ───────────────────────────────────────────────────────────────

export interface PipelineStage {
  id: string
  nombre: string
  color: string
  orden: number
  esObligatoria: boolean
  reglasTransicion?: string[]
}

export interface PipelineConfig {
  id: string
  companyId: string
  categoria: string
  stages: PipelineStage[]
  camposCustom: PipelineCampo[]
  automatizaciones: PipelineAutomatizaciones
  updatedAt: Date
}

export interface PipelineCampo {
  key: string
  label: string
  tipo: string
  opciones?: string[]
  obligatorio: boolean
}

export interface PipelineAutomatizaciones {
  bienvenida: boolean
  recordatorioDias: number
  cierre: boolean
  plantillas?: Record<string, string>
}

// ── Filtros de búsqueda ────────────────────────────────────────────────────

export interface LeadFilter {
  q?: string
  estado?: LeadEstado
  etapa?: LeadEtapa
  prioridad?: LeadPrioridad
  fuente?: LeadFuente
  canal?: LeadCanal
  asignadoA?: string
  desde?: string
  hasta?: string
}

export interface PaginacionParams {
  pagina?: number
  porPagina?: number
}

export interface LeadQueryResult {
  leads: Lead[]
  total: number
  pagina: number
  porPagina: number
  totalPaginas: number
}
