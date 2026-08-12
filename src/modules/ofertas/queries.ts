import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { inicioPeriodo } from '@/modules/ofertas/periodo'

/**
 * Ofertas VIP · consultas. Multi-tenant: todo filtrado por companyId.
 */

/** ¿La oferta sigue canjeable? (estado + vigencia). */
export function ofertaVigente(o: { estado: string; vigenciaHasta: Date | null }): boolean {
  if (o.estado !== 'ACTIVA') return false
  if (o.vigenciaHasta && o.vigenciaHasta.getTime() < Date.now()) return false
  return true
}

/** Listado del panel con conteos. */
export async function getOfertasAdmin(companyId: string) {
  return conEmpresa(companyId, (tx) =>
    tx.ofertaPrivada.findMany({
      where: { companyId },
      include: {
        _count: { select: { invitados: true } },
        invitados: { where: { reclamadaAt: { not: null } }, select: { id: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
  )
}

/** Detalle del panel: invitados con usos del período actual y totales. */
export async function getOfertaDetalleAdmin(companyId: string, ofertaId: string, timeZone: string) {
  const oferta = await conEmpresa(companyId, (tx) =>
    tx.ofertaPrivada.findFirst({
      where: { id: ofertaId, companyId },
      include: {
        invitados: {
          include: {
            cliente: { select: { id: true, nombre: true, email: true, telefono: true } },
            _count: { select: { usos: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    })
  )
  if (!oferta) return null

  const desde = inicioPeriodo(oferta.periodo, timeZone)
  const usosPeriodo = await conEmpresa(companyId, (tx) =>
    tx.ofertaUso.groupBy({
      by: ['invitadoId'],
      where: {
        invitado: { ofertaId: oferta.id },
        createdAt: { gte: desde },
      },
      _count: { _all: true },
    })
  )
  const porInvitado = new Map(usosPeriodo.map((u) => [u.invitadoId, u._count._all]))

  return {
    oferta,
    invitados: oferta.invitados.map((i) => ({
      id: i.id,
      cliente: i.cliente,
      reclamadaAt: i.reclamadaAt,
      usosTotales: i._count.usos,
      usosPeriodo: porInvitado.get(i.id) ?? 0,
    })),
  }
}

export type EstadoOfertaCliente =
  | 'NO_INVITADO'
  | 'INVITADO' // en la lista, sin reclamar
  | 'RECLAMADA'
  | 'NO_DISPONIBLE' // pausada/finalizada/vencida

/** Resolución del link /oferta/[codigo] para un cliente concreto. */
export async function getOfertaParaCliente(codigo: string, clienteId: string | null) {
  const oferta = await sinEmpresa('ofertas: buscar oferta por código único global', (tx) =>
    tx.ofertaPrivada.findUnique({
      where: { codigo },
      include: { company: { select: { name: true, zonaHoraria: true, logoUrl: true } } },
    })
  )
  if (!oferta) return null

  const invitado = clienteId
    ? await conEmpresa(oferta.companyId, (tx) =>
        tx.ofertaInvitado.findUnique({
          where: { ofertaId_clienteId: { ofertaId: oferta.id, clienteId } },
        })
      )
    : null

  let estadoCliente: EstadoOfertaCliente
  if (!invitado) estadoCliente = 'NO_INVITADO'
  else if (!ofertaVigente(oferta)) estadoCliente = 'NO_DISPONIBLE'
  else estadoCliente = invitado.reclamadaAt ? 'RECLAMADA' : 'INVITADO'

  let usosPeriodo = 0
  if (invitado) {
    usosPeriodo = await conEmpresa(oferta.companyId, (tx) =>
      tx.ofertaUso.count({
        where: {
          invitadoId: invitado.id,
          createdAt: { gte: inicioPeriodo(oferta.periodo, oferta.company.zonaHoraria) },
        },
      })
    )
  }

  return { oferta, invitado, estadoCliente, usosPeriodo }
}

/**
 * Ofertas reclamadas del cliente (para Mis beneficios).
 *
 * Por sus FICHAS, no por la activa. El resto de «Mis beneficios» ya listaba
 * las compras de todas ellas; este bloque seguía mirando una sola, así que en
 * la misma pantalla convivían las promociones de todos sus negocios con las
 * ofertas de uno. Ver `misClienteIds` en `afiliacion.ts`.
 */
export async function getRegalosCliente(clienteIds: string[]) {
  if (clienteIds.length === 0) return []
  const invitaciones = await sinEmpresa('ofertas: regalos del cliente cruzan sus empresas (panel cliente)', (tx) =>
    tx.ofertaInvitado.findMany({
      where: {
        clienteId: { in: clienteIds },
        reclamadaAt: { not: null },
        oferta: { estado: 'ACTIVA' },
      },
      include: {
        oferta: { include: { company: { select: { name: true, zonaHoraria: true } } } },
      },
      orderBy: { reclamadaAt: 'desc' },
    })
  )
  const activos = invitaciones.filter((i) => ofertaVigente(i.oferta))

  // Usos del período vigente en UNA consulta por `inicioPeriodo` distinto
  // (depende del periodo y la zona horaria del negocio): se agrega en la BD
  // con groupBy por invitado. Antes era un `count` por invitado (N queries).
  const buckets = new Map<string, { ids: string[]; desde: Date }>()
  for (const i of activos) {
    const desde = inicioPeriodo(i.oferta.periodo, i.oferta.company.zonaHoraria)
    const clave = String(desde.getTime())
    const bucket = buckets.get(clave)
    if (bucket) bucket.ids.push(i.id)
    else buckets.set(clave, { ids: [i.id], desde })
  }

  const usosPorInvitado = new Map<string, number>()
  await sinEmpresa('ofertas: buckets de usos pueden abarcar varias empresas (panel cliente)', async (tx) => {
    for (const bucket of buckets.values()) {
      const grupos = await tx.ofertaUso.groupBy({
        by: ['invitadoId'],
        where: {
          invitadoId: { in: bucket.ids },
          createdAt: { gte: bucket.desde },
        },
        _count: { _all: true },
      })
      for (const g of grupos) usosPorInvitado.set(g.invitadoId, g._count._all)
    }
  })

  return activos.map((i) => ({
    invitadoId: i.id,
    codigo: i.oferta.codigo,
    titulo: i.oferta.titulo,
    usosPorPeriodo: i.oferta.usosPorPeriodo,
    periodo: i.oferta.periodo,
    vigenciaHasta: i.oferta.vigenciaHasta,
    usosPeriodo: usosPorInvitado.get(i.id) ?? 0,
  }))
}
