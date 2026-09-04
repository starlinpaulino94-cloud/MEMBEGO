import { conEmpresa } from '@/lib/tenant'
import type { NotaTipo, NotaEstado } from './types'

// ── Types ──────────────────────────────────────────────────────────────────

export interface FiltroActividad {
  q?: string
  tipo?: NotaTipo | 'TODOS'
  estado?: NotaEstado | 'TODOS'
}

export interface ActividadResult {
  id: string
  leadId: string
  lead: { id: string; nombre: string }
  userId: string
  contenido: string
  tipo: string
  estado: string
  fechaProxima: Date | null
  createdAt: Date
}

// ── Queries ────────────────────────────────────────────────────────────────

/**
 * Lista actividades de seguimiento de una empresa, con filtros.
 */
export async function getActividades(
  companyId: string,
  filtro: FiltroActividad = {}
): Promise<ActividadResult[]> {
  const where: Record<string, unknown> = { lead: { companyId } }

  if (filtro.q) {
    where.OR = [
      { contenido: { contains: filtro.q, mode: 'insensitive' } },
      { lead: { nombre: { contains: filtro.q, mode: 'insensitive' } } },
    ]
  }

  if (filtro.tipo && filtro.tipo !== 'TODOS') {
    where.tipo = filtro.tipo
  }

  if (filtro.estado && filtro.estado !== 'TODOS') {
    where.estado = filtro.estado
  }

  return conEmpresa(companyId, (tx) =>
    tx.notaSeguimiento.findMany({
      where,
      include: { lead: { select: { id: true, nombre: true } } },
      orderBy: { createdAt: 'desc' },
    })
  ) as Promise<ActividadResult[]>
}

/**
 * Leads para el selector de nueva actividad.
 */
export async function getLeadsParaSelect(
  companyId: string
): Promise<{ id: string; nombre: string }[]> {
  return conEmpresa(companyId, (tx) =>
    tx.lead.findMany({
      where: { companyId, estado: { notIn: ['DESCARTADO'] } },
      select: { id: true, nombre: true },
      orderBy: { nombre: 'asc' },
    })
  )
}
