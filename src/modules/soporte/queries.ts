import type { Prisma } from '@prisma/client'
import { conEmpresa, sinEmpresa, type Tx } from '@/lib/tenant'
import { COLAS_TICKET, colaDeEstado, type ColaTicket } from '@/lib/soporte'
import { POR_PAGINA, type FiltroTickets } from './filtros'
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
 *
 * - ADMIN_EMPRESA: su propia empresa (companyId del metadata).
 * - SUPERADMIN: la empresa solicitada; si no, depende del PANEL (ver abajo).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL ALCANCE DEPENDE DEL PANEL, Y ANTES NO
 *
 * Esta función elegía SIEMPRE una empresa para el superadmin: la pedida, si no
 * la de su metadata, y si no **la primera de la lista**. Nunca devolvía `null`
 * mientras existiera una empresa.
 *
 * En el panel de empresa eso es correcto: ese panel opera sobre UNA empresa y
 * necesita una elegida. En el panel de PLATAFORMA era un fallo grave y mudo:
 * `/superadmin/tickets` es la bandeja de toda la plataforma y enseñaba los
 * tickets de la primera empresa alfabéticamente, sin decirlo. De rebote,
 * `showEmpresa` —que se calcula como «superadmin y sin empresa»— no se activaba
 * nunca, así que tampoco salía la columna que habría delatado el recorte.
 *
 * Y hacía mentir al Centro de control: su aviso cuenta los tickets pendientes
 * de TODAS las empresas, así que decía «7 abiertos» y al pulsar aparecían 2.
 *
 * `ambitoPlataforma` es lo que separa los dos casos. Cuando es true y no se
 * pidió empresa, `companyId` queda en `null` = todas.
 */
export async function resolveCompanyContext(
  user: SessionUser,
  requestedId?: string,
  opciones: { ambitoPlataforma?: boolean } = {}
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

  const pedida = exists(requestedId)
  const chosen = opciones.ambitoPlataforma
    ? // En plataforma solo manda la elección EXPLÍCITA del selector. Ni la
      // empresa del metadata ni «la primera»: las dos serían un recorte que
      // nadie pidió sobre una vista que se presenta como global.
      pedida
    : pedida || exists(user.metadata.companyId) || companies[0]?.id || null

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

export interface TicketFila {
  id: string
  asunto: string
  estado: string
  categoria: string
  clienteNombre: string
  empresaNombre: string
  empresaEsDemo: boolean
  mensajes: number
  /** Momento del último movimiento. La vista decide cómo escribirlo. */
  actualizado: Date
  /** Milisegundos desde ese movimiento, con un «ahora» común a toda la lista. */
  desdeUltimoMovimiento: number
}

export interface ListadoTickets {
  filas: TicketFila[]
  /** Cuántos hay en la cola mirada, con los demás filtros aplicados. */
  total: number
  /**
   * Cuántos hay en CADA cola.
   *
   * Salen de la base y no de las filas cargadas. Contarlos sobre la página
   * haría que la pestaña «Cerrados» dijera 25 cuando hay 900: un contador que
   * cuenta lo que ya se ve no informa de nada.
   */
  porCola: Record<ColaTicket, number>
}

/**
 * El `where` de la bandeja. TIPADO.
 *
 * Era un `Record<string, unknown>` al que se le iban asignando claves, así que
 * justo en el punto donde se construye el filtro —lo único que separa «los
 * tickets de esta empresa» de «los de todas»— no había ninguna comprobación.
 */
function whereTickets(
  companyId: string | null,
  isSuperadmin: boolean,
  f: FiltroTickets
): Prisma.SupportTicketWhereInput {
  const and: Prisma.SupportTicketWhereInput[] = []

  if (companyId) and.push({ companyId })
  // Fail-closed: un admin sin empresa no posee ninguna, y sin esto vería todas.
  else if (!isSuperadmin) and.push({ companyId: '__none__' })

  and.push({ estado: { in: [...COLAS_TICKET[f.cola]] } })

  // El ámbito solo tiene sentido cruzando empresas; acotado a una, sobra.
  if (!companyId && f.ambito !== 'todas') {
    and.push({ company: { esDemo: f.ambito === 'practica' } })
  }

  if (f.q) {
    and.push({
      OR: [
        { asunto: { contains: f.q, mode: 'insensitive' } },
        { cliente: { nombre: { contains: f.q, mode: 'insensitive' } } },
      ],
    })
  }

  return { AND: and }
}

/**
 * Lista de tickets para admin. `companyId` null (plataforma) = todas.
 *
 * BUSCA Y PAGINA EN LA BASE. Antes traía 200 filas de golpe y el navegador las
 * filtraba: al ticket 201 no se llegaba por ningún camino, y buscar un cliente
 * que existía devolvía «sin resultados» si su ticket estaba fuera de esas 200.
 * Los parámetros para filtrar ya existían en esta función; nadie se los pasaba.
 */
export async function listTicketsAdmin(
  companyId: string | null,
  isSuperadmin: boolean,
  f: FiltroTickets,
  opciones: { todo?: boolean } = {}
): Promise<ListadoTickets> {
  const where = whereTickets(companyId, isSuperadmin, f)

  const fn = async (tx: Tx): Promise<ListadoTickets> => {
    const [filas, total, porEstado] = await Promise.all([
      tx.supportTicket.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        // La exportación se lleva todo lo filtrado, con un tope duro: un CSV
        // sin límite es una consulta que un día tumba la página.
        skip: opciones.todo ? 0 : (f.pagina - 1) * POR_PAGINA,
        take: opciones.todo ? 5000 : POR_PAGINA,
        select: {
          id: true,
          asunto: true,
          estado: true,
          categoria: true,
          updatedAt: true,
          cliente: { select: { nombre: true } },
          company: { select: { name: true, esDemo: true } },
          _count: { select: { mensajes: true } },
        },
      }),
      tx.supportTicket.count({ where }),
      // Los contadores de las pestañas: un `groupBy` por estado con TODO menos
      // la cola. Así «Cerrados» dice cuántos hay dentro aunque estemos mirando
      // los pendientes, y sigue respetando empresa, ámbito y búsqueda.
      tx.supportTicket.groupBy({
        by: ['estado'],
        where: whereSinCola(companyId, isSuperadmin, f),
        _count: { _all: true },
      }),
    ])

    const porCola: Record<ColaTicket, number> = { pendientes: 0, esperando: 0, cerrados: 0 }
    for (const g of porEstado) {
      const cola = colaDeEstado(g.estado)
      if (cola) porCola[cola] += g._count._all
    }

    // Un solo «ahora» para toda la lista: leerlo por fila daría antigüedades
    // que no cuadran entre sí dentro de la misma pantalla.
    const ahora = Date.now()

    return {
      filas: filas.map((t) => ({
        id: t.id,
        asunto: t.asunto,
        estado: t.estado,
        categoria: t.categoria,
        clienteNombre: t.cliente.nombre,
        empresaNombre: t.company.name,
        empresaEsDemo: t.company.esDemo,
        mensajes: t._count.mensajes,
        actualizado: t.updatedAt,
        desdeUltimoMovimiento: ahora - t.updatedAt.getTime(),
      })),
      total,
      porCola,
    }
  }

  return companyId
    ? conEmpresa(companyId, fn)
    : sinEmpresa('soporte: todos los tickets (bandeja de plataforma)', fn)
}

/** El mismo filtro, sin la cola: es lo que cuentan las pestañas. */
function whereSinCola(
  companyId: string | null,
  isSuperadmin: boolean,
  f: FiltroTickets
): Prisma.SupportTicketWhereInput {
  const completo = whereTickets(companyId, isSuperadmin, f)
  const and = (completo.AND as Prisma.SupportTicketWhereInput[]).filter((c) => !('estado' in c))
  return { AND: and }
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

/**
 * LAS CONVERSACIONES DE LA PERSONA CON LOS NEGOCIOS.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ PASABA
 *
 * Se listaban los tickets de la ficha ACTIVA. Quien abría una consulta con un
 * negocio y luego entraba a otro dejaba de ver su propia conversación —y con
 * ella, la respuesta que estaba esperando—. Un hilo de soporte abierto que
 * desaparece de la vista es peor que no tener soporte: la persona cree que se
 * perdió y vuelve a escribir por otro canal.
 *
 * Cada ticket trae ahora el nombre de SU negocio: con hilos de varias empresas
 * en la misma lista, un asunto sin destinatario no dice con quién se está
 * hablando.
 *
 * `clienteIds` sale de `misClienteIds`, así que lo que acota la consulta son
 * sus fichas — no un identificador que venga de la vista.
 */
export async function listTicketsCliente(clienteIds: string[]) {
  if (clienteIds.length === 0) return []
  return sinEmpresa('soporte: mis tickets (todas mis fichas)', (tx) =>
    tx.supportTicket.findMany({
      where: { clienteId: { in: clienteIds } },
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: { select: { mensajes: true } },
        company: { select: { name: true } },
      },
      take: 100,
    })
  )
}
