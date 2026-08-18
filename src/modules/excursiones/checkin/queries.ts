import { conEmpresa } from '@/lib/tenant'
import { OFFSET_PLATAFORMA_MIN } from '@/modules/excursiones/metricas/nucleo'
import { resumenManifiesto } from './nucleo'

/**
 * El MANIFIESTO del día: quién sale hoy y quién se subió.
 *
 * Es la pantalla que el operador mira de pie junto al bus, así que trae lo que
 * sirve ahí —nombre, teléfono, cuántos son y si ya embarcaron— y nada más.
 */
export async function manifiestoDelDia(companyId: string, dia: string) {
  // El día local completo, en instantes UTC: una salida de las 6 de la mañana
  // y otra de las 9 de la noche son del MISMO día para el negocio.
  const desde = new Date(Date.parse(`${dia}T00:00:00.000Z`) - OFFSET_PLATAFORMA_MIN * 60_000)
  const hasta = new Date(Date.parse(`${dia}T23:59:59.999Z`) - OFFSET_PLATAFORMA_MIN * 60_000)

  const reservas = await conEmpresa(companyId, (tx) =>
    tx.reservaExc.findMany({
      where: { companyId, estado: { not: 'CANCELADA' }, fecha: { gte: desde, lte: hasta } },
      orderBy: [{ hora: 'asc' }, { numero: 'asc' }],
      take: 500,
      select: {
        id: true, numero: true, hora: true, adultos: true, ninos: true,
        estado: true, checkinAt: true, clienteId: true, excursionId: true,
        pasajeros: { select: { presente: true } },
      },
    })
  )
  if (reservas.length === 0) {
    return { filas: [], resumen: resumenManifiesto([]) }
  }

  const [clientes, excursiones] = await Promise.all([
    conEmpresa(companyId, (tx) =>
      tx.cliente.findMany({
        where: { id: { in: [...new Set(reservas.map((r) => r.clienteId))] }, companyId },
        select: { id: true, nombre: true, telefono: true },
      })
    ),
    conEmpresa(companyId, (tx) =>
      tx.excursion.findMany({
        where: { id: { in: [...new Set(reservas.map((r) => r.excursionId))] }, companyId },
        select: { id: true, nombre: true },
      })
    ),
  ])
  const porCliente = new Map(clientes.map((c) => [c.id, c]))
  const porExcursion = new Map(excursiones.map((e) => [e.id, e.nombre]))

  const filas = reservas.map((r) => {
    const cliente = porCliente.get(r.clienteId)
    return {
      id: r.id,
      numero: r.numero,
      hora: r.hora,
      cliente: cliente?.nombre ?? 'Cliente',
      telefono: cliente?.telefono ?? null,
      excursion: porExcursion.get(r.excursionId) ?? '—',
      totalPasajeros: r.pasajeros.length,
      presentes: r.pasajeros.filter((p) => p.presente).length,
      checkinAt: r.checkinAt,
      estado: r.estado,
    }
  })

  return { filas, resumen: resumenManifiesto(filas) }
}
