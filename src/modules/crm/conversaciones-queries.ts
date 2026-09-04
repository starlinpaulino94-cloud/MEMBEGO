import { prisma } from '@/lib/prisma'
import { conEmpresa } from '@/lib/tenant'
import type { Prisma } from '@prisma/client'

// ── Types ─────────────────────────────────────────────────────────────────

export type ConversacionCanal = 'WHATSAPP' | 'INSTAGRAM' | 'MESSENGER' | 'EMAIL'
export type ConversacionEstado = 'ABIERTA' | 'CERRADA' | 'ARCHIVADA'
export type MensajeDireccion = 'ENTRANTE' | 'SALIENTE'
export type MensajeTipo = 'TEXTO' | 'IMAGEN' | 'DOCUMENTO' | 'AUDIO' | 'UBICACION'
export type MensajeEstado = 'ENVIADO' | 'ENTREGADO' | 'LEIDO' | 'FALLIDO'

export interface Conversacion {
  id: string
  leadId: string
  companyId: string
  canal: ConversacionCanal
  canalThreadId: string | null
  estado: ConversacionEstado
  ultimoMensaje: string | null
  ultimaFecha: Date | null
  noLeidos: number
  createdAt: Date
  updatedAt: Date
  lead?: { id: string; nombre: string; email: string | null } | null
}

export interface Mensaje {
  id: string
  conversacionId: string
  direccion: MensajeDireccion
  tipo: MensajeTipo
  contenido: string
  metadata: Record<string, unknown> | null
  proveedorMsgId: string | null
  estado: MensajeEstado
  creadoPor: string | null
  createdAt: Date
}

export interface ConversacionFilter {
  q?: string
  estado?: ConversacionEstado
  canal?: ConversacionCanal
  leadId?: string
  desde?: string
  hasta?: string
}

export interface PaginacionParams {
  pagina?: number
  porPagina?: number
}

export interface ConversacionQueryResult {
  items: Conversacion[]
  total: number
  pagina: number
  porPagina: number
  totalPaginas: number
}

export interface MensajeQueryResult {
  items: Mensaje[]
  total: number
  pagina: number
  porPagina: number
  totalPaginas: number
}

export interface ConversacionesStats {
  total: number
  abiertas: number
  cerradas: number
  archivadas: number
  porCanal: Record<string, number>
  sinLeer: number
}

// ── Helpers ────────────────────────────────────────────────────────────────

function toConversacion(row: Record<string, unknown>): Conversacion {
  return row as unknown as Conversacion
}

function toMensaje(row: Record<string, unknown>): Mensaje {
  return row as unknown as Mensaje
}

function buildConversacionWhere(
  companyId: string,
  filtro: ConversacionFilter = {}
): Prisma.ConversacionWhereInput {
  const where: Prisma.ConversacionWhereInput = { companyId }

  if (filtro.q) {
    where.OR = [
      { ultimoMensaje: { contains: filtro.q, mode: 'insensitive' } },
      { lead: { nombre: { contains: filtro.q, mode: 'insensitive' } } },
    ]
  }
  if (filtro.estado) where.estado = filtro.estado
  if (filtro.canal) where.canal = filtro.canal
  if (filtro.leadId) where.leadId = filtro.leadId

  if (filtro.desde || filtro.hasta) {
    where.createdAt = {}
    if (filtro.desde) where.createdAt.gte = new Date(filtro.desde)
    if (filtro.hasta) where.createdAt.lte = new Date(filtro.hasta)
  }

  return where
}

// ── Queries ────────────────────────────────────────────────────────────────

/**
 * Lista conversaciones de una empresa con filtros, paginación y ordenamiento.
 */
export async function getConversaciones(
  companyId: string,
  filtro: ConversacionFilter = {},
  paginacion: PaginacionParams = {}
): Promise<ConversacionQueryResult> {
  const pagina = Math.max(1, paginacion.pagina ?? 1)
  const porPagina = Math.min(100, Math.max(1, paginacion.porPagina ?? 20))
  const skip = (pagina - 1) * porPagina

  const where = buildConversacionWhere(companyId, filtro)

  const [items, total] = await Promise.all([
    conEmpresa(companyId, (tx) =>
      tx.conversacion.findMany({
        where,
        include: { lead: { select: { id: true, nombre: true, email: true } } },
        orderBy: [{ ultimaFecha: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: porPagina,
      })
    ),
    conEmpresa(companyId, (tx) => tx.conversacion.count({ where })),
  ])

  return {
    items: items.map(toConversacion),
    total,
    pagina,
    porPagina,
    totalPaginas: Math.ceil(total / porPagina),
  }
}

/**
 * Obtiene una conversación por ID, verificando que pertenezca a la empresa.
 */
export async function getConversacionById(
  companyId: string,
  conversacionId: string
): Promise<Conversacion | null> {
  const row = await conEmpresa(companyId, (tx) =>
    tx.conversacion.findFirst({
      where: { id: conversacionId, companyId },
      include: { lead: { select: { id: true, nombre: true, email: true } } },
    })
  )
  return row ? toConversacion(row as Record<string, unknown>) : null
}

/**
 * Lista mensajes de una conversación con paginación (más recientes primero).
 */
export async function getMensajes(
  companyId: string,
  conversacionId: string,
  paginacion: PaginacionParams = {}
): Promise<MensajeQueryResult> {
  const pagina = Math.max(1, paginacion.pagina ?? 1)
  const porPagina = Math.min(100, Math.max(1, paginacion.porPagina ?? 50))
  const skip = (pagina - 1) * porPagina

  // Verificar que la conversación pertenece a la empresa
  const conv = await conEmpresa(companyId, (tx) =>
    tx.conversacion.findFirst({
      where: { id: conversacionId, companyId },
      select: { id: true },
    })
  )
  if (!conv) {
    return { items: [], total: 0, pagina, porPagina, totalPaginas: 0 }
  }

  const where: Prisma.MensajeWhereInput = { conversacionId }

  const [items, total] = await Promise.all([
    conEmpresa(companyId, (tx) =>
      tx.mensaje.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: porPagina,
      })
    ),
    conEmpresa(companyId, (tx) => tx.mensaje.count({ where })),
  ])

  return {
    items: items.map(toMensaje),
    total,
    pagina,
    porPagina,
    totalPaginas: Math.ceil(total / porPagina),
  }
}

/**
 * Estadísticas de conversaciones para el dashboard.
 */
export async function getConversacionesStats(
  companyId: string
): Promise<ConversacionesStats> {
  const [total, abiertas, cerradas, archivadas, porCanal, sinLeer] =
    await conEmpresa(companyId, async (tx) => {
      const t = await tx.conversacion.count({ where: { companyId } })

      const ab = await tx.conversacion.count({
        where: { companyId, estado: 'ABIERTA' },
      })

      const ce = await tx.conversacion.count({
        where: { companyId, estado: 'CERRADA' },
      })

      const ar = await tx.conversacion.count({
        where: { companyId, estado: 'ARCHIVADA' },
      })

      const canales = await tx.conversacion.groupBy({
        by: ['canal'],
        where: { companyId },
        _count: { _all: true },
      })

      const noLeidos = await tx.conversacion.aggregate({
        where: { companyId, noLeidos: { gt: 0 } },
        _sum: { noLeidos: true },
      })

      return [t, ab, ce, ar, canales, noLeidos._sum.noLeidos ?? 0]
    })

  const canalMap: Record<string, number> = {}
  for (const row of porCanal) {
    canalMap[row.canal] = row._count._all
  }

  return {
    total,
    abiertas: abiertas,
    cerradas: cerradas,
    archivadas: archivadas,
    porCanal: canalMap,
    sinLeer,
  }
}
