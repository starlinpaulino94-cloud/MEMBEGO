import 'server-only'

import { conEmpresa } from '@/lib/tenant'

/**
 * LA VIDA DE UN CLIENTE, EN UNA SOLA LÍNEA DE TIEMPO.
 *
 * Antes esta información existía repartida en seis pantallas —visitas aquí,
 * pagos allá, citas en su módulo, notas internas en otra pestaña— y la pregunta
 * que hace cualquiera al descolgar el teléfono («¿qué ha pasado con esta
 * persona?») no tenía respuesta en ningún sitio: había que reconstruirla
 * saltando de pantalla en pantalla y ordenando de cabeza.
 *
 * Aquí se juntan y se ordenan por fecha. Nada más. Es una lectura, no un
 * modelo nuevo: cada tipo de evento sigue viviendo en su tabla.
 */

export type TipoEvento =
  | 'REGISTRO'
  | 'MEMBRESIA'
  | 'PAGO'
  | 'VISITA'
  | 'COMPRA'
  | 'CITA'
  | 'NOTA'
  | 'NOTIFICACION'

export interface EventoCliente {
  id: string
  tipo: TipoEvento
  fecha: Date
  titulo: string
  detalle: string | null
  /** Importe, cuando el evento mueve dinero. */
  monto: number | null
  /** Quién lo hizo, cuando fue una persona del equipo. */
  autor: string | null
}

/**
 * Cuántos eventos se traen de cada fuente. No es un tope disimulado: la
 * pantalla dice cuántos está enseñando, y la línea de tiempo de un cliente se
 * lee para entender su historia reciente, no para auditar cinco años.
 * La bitácora completa vive en /admin/actividad.
 */
const POR_FUENTE = 40

export async function getHistorialCliente(
  companyId: string,
  clienteId: string,
  limite = 60
): Promise<EventoCliente[]> {
  try {
    return await conEmpresa(companyId, async (tx) => {
      const [cliente, visitas, membresias, compras, citas, notas, notificaciones] =
        await Promise.all([
          tx.cliente.findUnique({
            where: { id: clienteId },
            select: { createdAt: true, nombre: true, canalOrigen: true, supabaseId: true },
          }),
          tx.visit.findMany({
            where: { clienteId },
            select: {
              id: true,
              fechaVisita: true,
              servicio: true,
              vehiculo: { select: { marca: true, modelo: true, placa: true } },
            },
            orderBy: { fechaVisita: 'desc' },
            take: POR_FUENTE,
          }),
          tx.membership.findMany({
            where: { clienteId },
            select: {
              id: true,
              estado: true,
              createdAt: true,
              fechaInicio: true,
              fechaPago: true,
              montoPagado: true,
              pagoConfirmado: true,
              plan: { select: { nombre: true } },
              metodoPago: { select: { nombre: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: POR_FUENTE,
          }),
          tx.productoCompra.findMany({
            where: { clienteId },
            select: {
              id: true,
              estado: true,
              createdAt: true,
              precioCongelado: true,
              promocion: { select: { titulo: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: POR_FUENTE,
          }),
          tx.cita.findMany({
            where: { clienteId },
            select: { id: true, inicio: true, estado: true, servicio: true },
            orderBy: { inicio: 'desc' },
            take: POR_FUENTE,
          }),
          tx.clienteNota.findMany({
            where: { clienteId },
            select: {
              id: true,
              createdAt: true,
              texto: true,
              autor: { select: { name: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: POR_FUENTE,
          }),
          // Lo que el sistema le MANDÓ. Sin esto, la línea de tiempo cuenta lo
          // que el cliente hizo y calla lo que nosotros hicimos — y al llamar a
          // alguien conviene saber si ya se le escribió tres veces esta semana.
          tx.cliente
            .findUnique({ where: { id: clienteId }, select: { supabaseId: true } })
            .then((c) =>
              c
                ? tx.user
                    .findFirst({ where: { supabaseId: c.supabaseId }, select: { id: true } })
                    .then((u) =>
                      u
                        ? tx.notificacion.findMany({
                            where: { userId: u.id },
                            select: {
                              id: true,
                              createdAt: true,
                              titulo: true,
                              mensaje: true,
                              leida: true,
                            },
                            orderBy: { createdAt: 'desc' },
                            take: POR_FUENTE,
                          })
                        : []
                    )
                : []
            )
            .catch(() => []),
        ])

      const eventos: EventoCliente[] = []

      if (cliente) {
        eventos.push({
          id: `registro-${clienteId}`,
          tipo: 'REGISTRO',
          fecha: cliente.createdAt,
          titulo: 'Se registró',
          detalle: cliente.canalOrigen ? `Llegó por ${cliente.canalOrigen}` : null,
          monto: null,
          autor: null,
        })
      }

      for (const v of visitas) {
        const veh = v.vehiculo
          ? `${v.vehiculo.marca} ${v.vehiculo.modelo}${v.vehiculo.placa ? ` · ${v.vehiculo.placa}` : ''}`
          : null
        eventos.push({
          id: `visita-${v.id}`,
          tipo: 'VISITA',
          fecha: v.fechaVisita,
          titulo: 'Vino al negocio',
          detalle: [v.servicio, veh].filter(Boolean).join(' · ') || null,
          monto: null,
          autor: null,
        })
      }

      for (const m of membresias) {
        eventos.push({
          id: `membresia-${m.id}`,
          tipo: 'MEMBRESIA',
          fecha: m.createdAt,
          titulo: `Solicitó el plan ${m.plan.nombre}`,
          detalle: m.metodoPago ? `Pago por ${m.metodoPago.nombre}` : null,
          monto: null,
          autor: null,
        })
        // El cobro es un evento propio y con su fecha propia: solicitar y pagar
        // pueden estar separados por días, y confundirlos es lo que hacía que
        // los informes movieran ingresos de mes.
        if (m.pagoConfirmado) {
          eventos.push({
            id: `pago-${m.id}`,
            tipo: 'PAGO',
            fecha: m.fechaPago ?? m.fechaInicio ?? m.createdAt,
            titulo: `Pagó el plan ${m.plan.nombre}`,
            detalle: m.metodoPago?.nombre ?? null,
            monto: m.montoPagado != null ? Number(m.montoPagado) : null,
            autor: null,
          })
        }
      }

      for (const c of compras) {
        eventos.push({
          id: `compra-${c.id}`,
          tipo: 'COMPRA',
          fecha: c.createdAt,
          titulo: `Adquirió «${c.promocion?.titulo ?? 'una promoción'}»`,
          detalle: c.estado,
          monto: c.precioCongelado != null ? Number(c.precioCongelado) : null,
          autor: null,
        })
      }

      for (const c of citas) {
        eventos.push({
          id: `cita-${c.id}`,
          tipo: 'CITA',
          fecha: c.inicio,
          titulo: 'Cita agendada',
          detalle: [c.servicio, c.estado].filter(Boolean).join(' · ') || null,
          monto: null,
          autor: null,
        })
      }

      for (const n of notas) {
        eventos.push({
          id: `nota-${n.id}`,
          tipo: 'NOTA',
          fecha: n.createdAt,
          titulo: 'Nota interna',
          detalle: n.texto,
          monto: null,
          autor: n.autor?.name ?? null,
        })
      }

      for (const n of notificaciones) {
        eventos.push({
          id: `notif-${n.id}`,
          tipo: 'NOTIFICACION',
          fecha: n.createdAt,
          titulo: n.titulo,
          detalle: `${n.mensaje}${n.leida ? '' : ' · sin leer'}`,
          monto: null,
          autor: 'Sistema',
        })
      }

      return eventos.sort((a, b) => b.fecha.getTime() - a.fecha.getTime()).slice(0, limite)
    })
  } catch (e) {
    console.error('[cliente/historial]', e)
    return []
  }
}
