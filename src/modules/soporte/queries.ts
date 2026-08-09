import { conEmpresa, sinEmpresa, type Tx } from '@/lib/tenant'
import type { SessionUser } from '@/types'

export interface CompanyOption {
  id: string
  name: string
}

export interface CompanyContext {
  /** Empresa activa (null si el superadmin aún no ha elegido / no hay empresas). */
  companyId: string | null
  isSuperadmin: boolean
  /** Lista de empresas para el selector (solo poblada para superadmin). */
  companies: CompanyOption[]
}

/**
 * Resuelve la empresa sobre la que opera el panel.
 * - ADMIN_EMPRESA: su propia empresa (companyId del metadata).
 * - SUPERADMIN: la empresa solicitada en la página (requestedId); si no, la
 *   empresa ACTIVA del selector del panel (metadata.companyId); si tampoco,
 *   la primera disponible.
 *
 * Esto corrige el error "Empresa requerida": el superadmin no tiene companyId
 * propio, así que necesita un selector explícito; y además honra el selector
 * global del panel para que el contexto sea consistente entre módulos.
 */
export async function resolveCompanyContext(
  user: SessionUser,
  requestedId?: string
): Promise<CompanyContext> {
  const isSuperadmin = user.metadata.role === 'SUPERADMIN'

  if (!isSuperadmin) {
    return {
      companyId: user.metadata.companyId ?? null,
      isSuperadmin: false,
      companies: [],
    }
  }

  const companies = await sinEmpresa('soporte: lista de empresas para selector de superadmin', (tx) =>
    tx.company.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    })
  )

  const exists = (id?: string | null) =>
    (id && companies.find((c) => c.id === id)?.id) || null

  const chosen =
    exists(requestedId) ||
    exists(user.metadata.companyId) ||
    companies[0]?.id ||
    null

  return { companyId: chosen, isSuperadmin: true, companies }
}

export async function getComunicacionConfig(companyId: string | null) {
  if (!companyId) return null
  return conEmpresa(companyId, (tx) => tx.whatsAppConfig.findUnique({ where: { companyId } }))
}

export async function getFaqs(
  companyId: string | null,
  opts: { activeOnly?: boolean } = {}
) {
  if (!companyId) return []
  return conEmpresa(companyId, (tx) =>
    tx.faqItem.findMany({
      where: { companyId, ...(opts.activeOnly ? { activo: true } : {}) },
      orderBy: [{ orden: 'asc' }, { createdAt: 'asc' }],
    })
  )
}

export interface TicketFilters {
  estado?: string
  q?: string
}

/** Lista de tickets para admin. companyId null (superadmin sin empresa) => todos. */
export async function listTicketsAdmin(
  companyId: string | null,
  isSuperadmin: boolean,
  filters: TicketFilters = {}
) {
  const where: Record<string, unknown> = {}
  if (companyId) where.companyId = companyId
  else if (!isSuperadmin) where.companyId = '__none__'

  if (filters.estado && filters.estado !== 'TODOS') where.estado = filters.estado
  if (filters.q) {
    where.OR = [
      { asunto: { contains: filters.q, mode: 'insensitive' } },
      { cliente: { nombre: { contains: filters.q, mode: 'insensitive' } } },
    ]
  }

  const fn = (tx: Tx) =>
    tx.supportTicket.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        cliente: { select: { nombre: true, email: true } },
        company: { select: { name: true } },
        _count: { select: { mensajes: true } },
      },
      take: 200,
    })

  return companyId
    ? conEmpresa(companyId, fn)
    : sinEmpresa('soporte: todos los tickets (superadmin sin empresa)', fn)
}

// `ticketStats` vivía aquí: cuatro conteos para las tarjetas de la bandeja.
// Contaba tres de los cinco estados —ESPERANDO_CLIENTE y CERRADO quedaban
// fuera—, así que el desglose no sumaba el total. Las pestañas de cola cuentan
// sobre los tickets ya cargados, sin cuatro consultas extra.

/** Detalle de un ticket. includeInternal controla si se ven las notas internas. */
export async function getTicketDetail(id: string, includeInternal: boolean) {
  return sinEmpresa('soporte: ticket por id (la página valida el acceso)', (tx) =>
    tx.supportTicket.findUnique({
      where: { id },
      include: {
        cliente: { select: { id: true, nombre: true, email: true, telefono: true } },
        company: { select: { id: true, name: true } },
        mensajes: {
          where: includeInternal ? {} : { esNotaInterna: false },
          orderBy: { createdAt: 'asc' },
        },
      },
    })
  )
}

export async function listTicketsCliente(clienteId: string) {
  return sinEmpresa('soporte: tickets por cliente (solo id)', (tx) =>
    tx.supportTicket.findMany({
      where: { clienteId },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { mensajes: true } } },
      take: 100,
    })
  )
}
