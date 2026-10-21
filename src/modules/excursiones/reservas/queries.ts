import { conEmpresa, type Tx } from '@/lib/tenant'
import { generarCodigo } from '@/lib/codes'
import { anotarFallo } from '@/lib/prisma-errors'
import type { Prisma } from '@prisma/client'
import type { Paginacion } from '@/lib/paginacion'
import { calcularSaldo, type ReglaPrecioDinamico } from './nucleo'
import { condicionDeEstado, type VerReservas } from './lista'

/**
 * Las reservas guardan ids planos hacia el Core (cliente, excursión, vendedor)
 * sin relación de Prisma: el módulo del vertical no se enreda con las tablas
 * del núcleo. Los nombres se resuelven aquí, en una lectura por tipo — nunca
 * una consulta por fila.
 */
async function nombresDeApoyo(
  companyId: string,
  ids: { clientes: string[]; excursiones: string[]; vendedores: string[] }
) {
  const [clientes, excursiones, vendedores] = await Promise.all([
    ids.clientes.length
      ? conEmpresa(companyId, (tx) =>
          tx.cliente.findMany({
            where: { id: { in: ids.clientes }, companyId },
            select: { id: true, nombre: true, telefono: true },
          })
        )
      : Promise.resolve([]),
    ids.excursiones.length
      ? conEmpresa(companyId, (tx) =>
          tx.excursion.findMany({
            where: { id: { in: ids.excursiones }, companyId },
            select: { id: true, nombre: true },
          })
        )
      : Promise.resolve([]),
    ids.vendedores.length
      ? conEmpresa(companyId, (tx) =>
          tx.vendedor.findMany({
            where: { id: { in: ids.vendedores }, companyId },
            select: { id: true, nombre: true, apellido: true, codigo: true },
          })
        )
      : Promise.resolve([]),
  ])
  return {
    clientes: new Map(clientes.map((c) => [c.id, c])),
    excursiones: new Map(excursiones.map((e) => [e.id, e])),
    vendedores: new Map(vendedores.map((v) => [v.id, v])),
  }
}

const unicos = (valores: (string | null)[]) =>
  [...new Set(valores.filter((v): v is string => !!v))]

/**
 * Listado de reservas con lo que el mostrador necesita ver de un vistazo, PAGINADO por el servidor (06 · T-04).
 *
 * Antes: las 200 más recientes y nada más, con la búsqueda y las «archivadas» filtradas en el navegador sobre esas 200. Ahora el
 * estado, la búsqueda y la página los resuelve la base sobre TODAS las reservas de la empresa, y devuelve el total real para que
 * la pantalla diga «mostrando N de M» en vez de ocultar lo que no cupo.
 *
 * La búsqueda mira el número de la reserva y, como el cliente, la excursión y el vendedor son ids planos hacia el Core (sin
 * relación de Prisma), primero resuelve qué ids coinciden por nombre y luego los usa en la condición.
 */
export async function listarReservas(
  companyId: string,
  opciones: { q?: string; ver?: VerReservas; paginacion: Pick<Paginacion, 'saltar' | 'tomar'> }
) {
  const { q = '', ver = 'abiertas', paginacion } = opciones
  const like = { contains: q, mode: 'insensitive' as const }

  const { reservas, total, hayAlgunaSinFiltro } = await conEmpresa(companyId, async (tx) => {
    let coincidencias: Prisma.ReservaExcWhereInput[] | null = null
    if (q) {
      const [clientes, excursiones, vendedores] = await Promise.all([
        tx.cliente.findMany({ where: { companyId, OR: [{ nombre: like }, { telefono: { contains: q } }] }, select: { id: true }, take: 500 }),
        tx.excursion.findMany({ where: { companyId, nombre: like }, select: { id: true }, take: 500 }),
        tx.vendedor.findMany({ where: { companyId, OR: [{ nombre: like }, { apellido: like }, { codigo: like }] }, select: { id: true }, take: 500 }),
      ])
      coincidencias = [{ numero: like }]
      if (clientes.length) coincidencias.push({ clienteId: { in: clientes.map((c) => c.id) } })
      if (excursiones.length) coincidencias.push({ excursionId: { in: excursiones.map((e) => e.id) } })
      if (vendedores.length) coincidencias.push({ vendedorId: { in: vendedores.map((v) => v.id) } })
    }
    const where: Prisma.ReservaExcWhereInput = {
      companyId,
      ...condicionDeEstado(ver),
      ...(coincidencias ? { OR: coincidencias } : {}),
    }
    const [reservas, total] = await Promise.all([
      tx.reservaExc.findMany({
        where,
        orderBy: [{ fecha: 'desc' }, { createdAt: 'desc' }],
        skip: paginacion.saltar,
        take: paginacion.tomar,
        select: {
          id: true,
          numero: true,
          fecha: true,
          hora: true,
          adultos: true,
          ninos: true,
          total: true,
          moneda: true,
          estado: true,
          clienteId: true,
          excursionId: true,
          vendedorId: true,
          pagos: { select: { monto: true, estado: true } },
        },
      }),
      tx.reservaExc.count({ where }),
    ])
    // Solo si no salió nada: ¿es que no hay reservas, o es que el filtro las esconde? La pantalla dice cosas distintas.
    const hayAlgunaSinFiltro = reservas.length === 0 ? (await tx.reservaExc.count({ where: { companyId } })) > 0 : true
    return { reservas, total, hayAlgunaSinFiltro }
  })
  if (reservas.length === 0) return { filas: [], total, hayAlgunaSinFiltro }

  const apoyo = await nombresDeApoyo(companyId, {
    clientes: unicos(reservas.map((r) => r.clienteId)),
    excursiones: unicos(reservas.map((r) => r.excursionId)),
    vendedores: unicos(reservas.map((r) => r.vendedorId)),
  })

  const filas = reservas.map((r) => {
    const totalReserva = Number(r.total)
    const { pagado, saldo } = calcularSaldo(
      totalReserva,
      r.pagos.map((p) => ({ monto: Number(p.monto), estado: p.estado }))
    )
    const vendedor = r.vendedorId ? apoyo.vendedores.get(r.vendedorId) : null
    return {
      id: r.id,
      numero: r.numero,
      fecha: r.fecha,
      hora: r.hora,
      pasajeros: r.adultos + r.ninos,
      total: totalReserva,
      pagado,
      saldo,
      moneda: r.moneda,
      estado: r.estado,
      cliente: apoyo.clientes.get(r.clienteId)?.nombre ?? 'Cliente',
      excursion: apoyo.excursiones.get(r.excursionId)?.nombre ?? '—',
      vendedor: vendedor ? `${vendedor.nombre} ${vendedor.apellido ?? ''}`.trim() : null,
      vendedorCodigo: vendedor?.codigo ?? null,
    }
  })
  return { filas, total, hayAlgunaSinFiltro }
}

/** Expediente de la reserva: datos, pasajeros, pagos vivos y saldo real. */
export async function reservaDetalle(companyId: string, reservaId: string) {
  const reserva = await conEmpresa(companyId, (tx) =>
    tx.reservaExc.findFirst({
      where: { id: reservaId, companyId },
      include: {
        pagos: { orderBy: { createdAt: 'desc' } },
        pasajeros: { orderBy: { tipo: 'asc' } },
        items: {
          orderBy: { fecha: 'asc' },
          include: {
            actividad: {
              select: {
                id: true,
                nombre: true,
                slug: true,
                tipoItem: true,
                duracionMin: true,
                portadaUrl: true,
                ubicacion: true,
                categoria: true,
                puntoSalida: true,
                horaSalida: true,
                horaRegreso: true,
              },
            },
          },
        },
      },
    })
  )
  if (!reserva) return null

  const apoyo = await nombresDeApoyo(companyId, {
    clientes: [reserva.clienteId],
    excursiones: [reserva.excursionId],
    vendedores: unicos([reserva.vendedorId]),
  })
  const vendedor = reserva.vendedorId ? apoyo.vendedores.get(reserva.vendedorId) : null

  const total = Number(reserva.total)
  const saldo = calcularSaldo(
    total,
    reserva.pagos.map((p) => ({ monto: Number(p.monto), estado: p.estado }))
  )
  return {
    reserva,
    saldo,
    cliente: apoyo.clientes.get(reserva.clienteId) ?? null,
    excursion: apoyo.excursiones.get(reserva.excursionId) ?? null,
    vendedor: vendedor
      ? { id: vendedor.id, nombre: `${vendedor.nombre} ${vendedor.apellido ?? ''}`.trim(), codigo: vendedor.codigo }
      : null,
  }
}

/** Excursiones reservables (con al menos una variante activa) y sus precios. */
export async function excursionesReservables(companyId: string) {
  const excursiones = await conEmpresa(companyId, (tx) =>
    tx.excursion.findMany({
      where: { companyId, estado: { notIn: ['ARCHIVADA', 'PAUSADA'] } },
      orderBy: { nombre: 'asc' },
      select: {
        id: true,
        nombre: true,
        portadaUrl: true,
        duracionMin: true,
        categoria: true,
        tipoItem: true,
        ubicacion: true,
        moneda: true,
        impuestoPct: true,
        comboItems: {
          orderBy: { orden: 'asc' },
          select: {
            actividad: {
              select: {
                id: true,
                nombre: true,
                tipoItem: true,
                duracionMin: true,
                horaSalida: true,
                horarios: {
                  where: { activo: true },
                  select: { id: true, horaSalida: true, diasSemana: true },
                },
              },
            },
          },
        },
        variantes: {
          where: { activa: true },
          orderBy: { createdAt: 'asc' },
          select: { id: true, nombre: true, precioAdulto: true, precioNino: true, preciosDinamicos: true },
        },
        horarios: {
          select: { id: true, horaSalida: true, diasSemana: true },
        },
      },
    })
  )
  // Sin variante activa no hay precio, y sin precio no hay reserva honesta.
  return excursiones
    .filter((e) => e.variantes.length > 0)
    .map((e) => ({
      id: e.id,
      nombre: e.nombre,
      portadaUrl: e.portadaUrl,
      duracionMin: e.duracionMin,
      categoria: e.categoria,
      tipoItem: e.tipoItem,
      ubicacion: e.ubicacion,
      moneda: e.moneda,
      impuestoPct: e.impuestoPct != null ? Number(e.impuestoPct) : null,
      comboItems: e.comboItems.map((ci) => ({
        id: ci.actividad.id,
        nombre: ci.actividad.nombre,
        tipoItem: ci.actividad.tipoItem,
        duracionMin: ci.actividad.duracionMin,
        horaSalida: ci.actividad.horaSalida,
        horarios: ci.actividad.horarios.map((h) => ({
          id: h.id,
          horaSalida: h.horaSalida,
          diasSemana: Array.isArray(h.diasSemana) ? (h.diasSemana as number[]) : [],
        })),
      })),
      variantes: e.variantes.map((v) => ({
        id: v.id,
        nombre: v.nombre,
        precioAdulto: Number(v.precioAdulto),
        precioNino: v.precioNino != null ? Number(v.precioNino) : null,
        preciosDinamicos: v.preciosDinamicos as unknown as ReglaPrecioDinamico[] | undefined,
      })),
      horarios: e.horarios.map((h) => ({
        id: h.id,
        horaSalida: h.horaSalida,
        // `diasSemana` es JSON en el esquema (evoluciona sin migrar). Se
        // normaliza aquí, en el borde, para que el formulario reciba el
        // number[] que declara y no un JsonValue que tendría que castear.
        diasSemana: Array.isArray(h.diasSemana) ? (h.diasSemana as number[]) : [],
      })),
    }))
}

/** Clientes de la empresa para el selector del alta (los más recientes). */
export async function clientesParaReserva(companyId: string) {
  return conEmpresa(companyId, (tx) =>
    tx.cliente.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { id: true, nombre: true, email: true, telefono: true },
    })
  )
}

/** Detalle de reserva para el cliente (solo sus propias reservas). */
export async function reservaCliente(companyId: string, clienteId: string, reservaId: string) {
  const reserva = await conEmpresa(companyId, (tx) =>
    tx.reservaExc.findFirst({
      where: { id: reservaId, companyId, clienteId },
      include: {
        pasajeros: { orderBy: { tipo: 'asc' } },
        items: {
          orderBy: { fecha: 'asc' },
          include: {
            actividad: {
              select: {
                id: true,
                nombre: true,
                slug: true,
                tipoItem: true,
                duracionMin: true,
                portadaUrl: true,
                ubicacion: true,
                categoria: true,
                puntoSalida: true,
                horaSalida: true,
                horaRegreso: true,
              },
            },
          },
        },
        pagos: { where: { estado: 'REGISTRADO' }, orderBy: { createdAt: 'desc' } },
      },
    })
  )
  if (!reserva) return null

  let checkinToken = reserva.checkinToken
  if (!checkinToken) {
    checkinToken = generarCodigo(24)
    await conEmpresa(companyId, (tx) =>
      tx.reservaExc.update({
        where: { id: reserva.id },
        data: { checkinToken },
      })
    ).catch(anotarFallo('excursiones:reservas:reservaCliente:autoToken'))
  }

  const { checkinAt, checkinPorId } = reserva

  const [excursion, variante] = await Promise.all([
    conEmpresa(companyId, (tx) =>
      tx.excursion.findFirst({
        where: { id: reserva.excursionId, companyId },
        select: {
          id: true,
          nombre: true,
          slug: true,
          descripcion: true,
          portadaUrl: true,
          galeria: true,
          duracionMin: true,
          ubicacion: true,
          categoria: true,
          moneda: true,
          impuestoPct: true,
          puntoSalida: true,
          horaSalida: true,
          horaRegreso: true,
          incluye: true,
          noIncluye: true,
          politicas: true,
          tipoItem: true,
          comboItems: {
            orderBy: { orden: 'asc' },
            select: {
              actividad: {
                select: {
                  id: true,
                  nombre: true,
                  tipoItem: true,
                  duracionMin: true,
                  horaSalida: true,
                  horaRegreso: true,
                  categoria: true,
                },
              },
            },
          },
        },
      })
    ),
    conEmpresa(companyId, (tx) =>
      tx.excursionVariante.findFirst({
        where: {
          excursionId: reserva.excursionId,
          ...(reserva.varianteId ? { id: reserva.varianteId } : { activa: true }),
        },
        select: { id: true, nombre: true, precioAdulto: true, precioNino: true },
        orderBy: { orden: 'asc' },
      })
    ),
  ])

  const saldo = calcularSaldo(
    Number(reserva.total),
    reserva.pagos.map((p) => ({ monto: Number(p.monto), estado: p.estado }))
  )

  return { reserva, excursion, variante, saldo, checkinToken, checkinAt, checkinPorId }
}

/** Todas las reservas del cliente en una empresa, ordenadas por fecha desc. */
export async function reservasCliente(
  companyId: string,
  clienteId: string
): Promise<{
  id: string
  numero: string
  estado: string
  fecha: Date
  hora: string | null
  adultos: number
  ninos: number
  total: number
  moneda: string
  excursion: { id: string; nombre: string; slug: string; portadaUrl: string | null }
}[]> {
  const reservas = await conEmpresa(companyId, (tx) =>
    tx.reservaExc.findMany({
      where: { companyId, clienteId },
      orderBy: [{ fecha: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        numero: true,
        fecha: true,
        hora: true,
        adultos: true,
        ninos: true,
        total: true,
        moneda: true,
        estado: true,
        excursionId: true,
      },
    })
  )
  if (reservas.length === 0) return []

  const excursiones = await conEmpresa(companyId, (tx) =>
    tx.excursion.findMany({
      where: { id: { in: reservas.map((r) => r.excursionId) }, companyId },
      select: { id: true, nombre: true, slug: true, portadaUrl: true },
    })
  )
  const excMap = new Map(excursiones.map((e) => [e.id, e]))

  return reservas.map((r) => {
    const exc = excMap.get(r.excursionId)
    return {
      id: r.id,
      numero: r.numero,
      estado: r.estado,
      fecha: r.fecha,
      hora: r.hora,
      adultos: r.adultos,
      ninos: r.ninos,
      total: Number(r.total),
      moneda: r.moneda,
      excursion: exc
        ? { id: exc.id, nombre: exc.nombre, slug: exc.slug, portadaUrl: exc.portadaUrl }
        : { id: '', nombre: '—', slug: '', portadaUrl: null },
    }
  })
}

/**
 * Valida la capacidad en tiempo real en la base de datos para una actividad, fecha y turno específico,
 * considerando tanto reservas directas como reservas provenientes de combos (ReservaItem).
 */
export async function verificarYBloquearCupoActividad(
  // El cliente de transacción de Prisma tiene nombre en el proyecto desde
  // `@/lib/tenant`. Con `any` esta función perdía la comprobación de TODAS sus
  // consultas, que es justo lo que no conviene en el camino que bloquea cupo.
  tx: Tx,
  params: {
    companyId: string
    actividadId: string
    fecha: Date
    hora: string | null
    pasajeros: number
    nombreActividad?: string
  }
): Promise<{ ok: true; cupoRestante: number } | { ok: false; error: string }> {
  const { companyId, actividadId, fecha, hora, pasajeros, nombreActividad } = params

  const act = await tx.excursion.findFirst({
    where: { id: actividadId, companyId },
    select: {
      id: true,
      nombre: true,
      tipoItem: true,
      capacidad: true,
      horaSalida: true,
      horarios: {
        where: { activo: true },
        select: { id: true, horaSalida: true, diasSemana: true, cupo: true },
      },
    },
  })

  if (!act) {
    return { ok: false, error: `La actividad no existe en el catálogo.` }
  }

  const nombre = nombreActividad || act.nombre
  const esPaseDia = act.tipoItem === 'PASE_DIA'
  const horaNorm = hora ? hora.trim().slice(0, 5) : null

  // Cupo máximo declarado
  let cupoMaximo = act.capacidad && act.capacidad > 0 ? act.capacidad : 50
  if (!esPaseDia && horaNorm && act.horarios && act.horarios.length > 0) {
    const hEncontrado = act.horarios.find(
      (h: { horaSalida: string | null; cupo: number | null }) =>
        (h.horaSalida || '').trim().slice(0, 5) === horaNorm
    )
    if (hEncontrado && hEncontrado.cupo && hEncontrado.cupo > 0) {
      cupoMaximo = Math.min(cupoMaximo, hEncontrado.cupo)
    }
  }

  // Rango del día para la fecha solicitada
  const inicioDia = new Date(fecha)
  inicioDia.setUTCHours(0, 0, 0, 0)
  const finDia = new Date(fecha)
  finDia.setUTCHours(23, 59, 59, 999)

  // 1. Contar reservas directas activas
  const directas = await tx.reservaExc.aggregate({
    _sum: { adultos: true, ninos: true },
    where: {
      companyId,
      excursionId: actividadId,
      fecha: { gte: inicioDia, lte: finDia },
      ...(esPaseDia || !horaNorm ? {} : { hora: horaNorm }),
      estado: { notIn: ['CANCELADA', 'REEMBOLSADA', 'NO_SHOW'] },
    },
  })

  // 2. Contar items de reservas de combos activas
  const itemsCombos = await tx.reservaItem.aggregate({
    _sum: { adultos: true, ninos: true },
    where: {
      companyId,
      actividadId,
      fecha: { gte: inicioDia, lte: finDia },
      ...(esPaseDia || !horaNorm ? {} : { hora: horaNorm }),
      estado: { notIn: ['CANCELADA'] },
      reserva: {
        estado: { notIn: ['CANCELADA', 'REEMBOLSADA', 'NO_SHOW'] },
      },
    },
  })

  const ocupadosDirectos = (directas._sum.adultos || 0) + (directas._sum.ninos || 0)
  const ocupadosCombos = (itemsCombos._sum.adultos || 0) + (itemsCombos._sum.ninos || 0)
  const totalOcupados = ocupadosDirectos + ocupadosCombos

  const disponibles = Math.max(0, cupoMaximo - totalOcupados)
  if (totalOcupados + pasajeros > cupoMaximo) {
    const fechaStr = fecha.toISOString().split('T')[0]
    const horaMsg = horaNorm ? ` a las ${horaNorm}` : ''
    return {
      ok: false,
      error: `La actividad "${nombre}" no tiene cupo suficiente para el ${fechaStr}${horaMsg} (disponibles: ${disponibles}, solicitados: ${pasajeros}).`,
    }
  }

  return { ok: true, cupoRestante: disponibles - pasajeros }
}
