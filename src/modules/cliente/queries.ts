import { sinEmpresa } from '@/lib/tenant'

/**
 * Load all memberships for a user across all companies.
 * Used for the "Mis Membresías" dashboard.
 *
 * Busca los clientes del usuario por `supabaseId` y, como respaldo, por el
 * `clienteId` del token de sesión (app_metadata). Esto evita que la lista quede
 * vacía si el `cliente.supabaseId` de algún registro no coincide exactamente con
 * el de la sesión (p. ej. datos creados por un admin o migrados).
 *
 * Devuelve objetos PLANOS y serializables (precio convertido a number) porque el
 * resultado se pasa a un Client Component; un `Decimal` de Prisma rompería el
 * render con "Only plain objects can be passed to Client Components".
 *
 * Propaga los errores (no los traga) para que la página distinga "sin
 * membresías" de "falló la carga".
 */
export async function getClienteAllMemberships(
  supabaseId: string,
  clienteId?: string | null
) {
  if (!supabaseId && !clienteId) {
    console.warn('[getClienteAllMemberships] Missing supabaseId y clienteId')
    return []
  }

  try {
    const or = [
      ...(supabaseId ? [{ supabaseId }] : []),
      ...(clienteId ? [{ id: clienteId }] : []),
    ]
    const clientes = await sinEmpresa('cliente: buscar mis cuentas de cliente', (tx) =>
      tx.cliente.findMany({
        where: { OR: or },
        select: { id: true },
      })
    )
    const clienteIds = clientes.map((c) => c.id)
    if (clienteIds.length === 0) return []

    // Membresías (con plan y empresa). Se consultan aparte de los QR para que un
    // problema con las columnas de qr_tokens (activo/membresiaId) no tumbe toda
    // la lista.
    const memberships = await sinEmpresa('cliente: mis membresías (todas las empresas)', (tx) =>
      tx.membership.findMany({
        where: { clienteId: { in: clienteIds } },
        include: {
          plan: true,
          company: {
            select: { id: true, name: true, logoUrl: true, type: true, colorPrimario: true },
          },
        },
        orderBy: [{ estado: 'asc' }, { fechaVencimiento: 'desc' }],
      })
    )

    // QR activos por membresía — resiliente: si falla (drift de esquema), la
    // lista sigue mostrándose sin QR en vez de romperse por completo.
    const qrByMembership = new Map<string, { id: string; token: string }>()
    try {
      const qrs = await sinEmpresa('cliente: mis QR activos', (tx) =>
        tx.qrToken.findMany({
          where: { membresiaId: { in: memberships.map((m) => m.id) }, activo: true },
          select: { id: true, token: true, membresiaId: true },
        })
      )
      for (const q of qrs) {
        if (q.membresiaId && !qrByMembership.has(q.membresiaId)) {
          qrByMembership.set(q.membresiaId, { id: q.id, token: q.token })
        }
      }
    } catch (qrError) {
      console.error('[getClienteAllMemberships] QR fetch failed (posible drift de esquema):', qrError)
    }

    return memberships
      .map((m) => ({
        id: m.id,
        clienteId: m.clienteId,
        companyId: m.companyId,
        company: m.company,
        plan: {
          id: m.plan.id,
          nombre: m.plan.nombre,
          precio: Number(m.plan.precio),
          esIlimitado: m.plan.esIlimitado,
          lavadosIncluidos: m.plan.lavadosIncluidos,
        },
        estado: m.estado,
        fechaVencimiento: m.fechaVencimiento,
        fechaInicio: m.fechaInicio,
        lavadosRestantes: m.lavadosRestantes,
        qrToken: qrByMembership.get(m.id) ?? null,
      }))
      .sort((a, b) => {
        const orden = {
          ACTIVA: 0,
          PENDIENTE_PAGO: 1,
          PENDIENTE: 2,
          VENCIDA: 3,
          CANCELADA: 4,
          RECHAZADA: 5,
        }
        const aOrd = orden[a.estado as keyof typeof orden] ?? 99
        const bOrd = orden[b.estado as keyof typeof orden] ?? 99
        if (aOrd !== bOrd) return aOrd - bOrd
        if (a.fechaVencimiento && b.fechaVencimiento) {
          return a.fechaVencimiento.getTime() - b.fechaVencimiento.getTime()
        }
        return 0
      })
  } catch (error) {
    console.error('[getClienteAllMemberships] Error:', error)
    throw error
  }
}

import { unstable_cache } from 'next/cache'
import { misClienteIds } from '@/modules/cliente/afiliacion'

/**
 * Empresas donde el usuario tiene cuenta de cliente — para el switcher del
 * layout, que corre en CADA navegación. Cacheada 5 min por usuario y con
 * select explícito (un include completo de `company` convierte cualquier
 * columna sin migrar en un fallo por clic).
 */
export const getClienteCompaniesCached = unstable_cache(
  async (supabaseId: string) =>
    sinEmpresa('cliente: mis empresas (cuentas cross-tenant)', (tx) =>
      tx.cliente.findMany({
        where: { supabaseId },
        select: {
          id: true,
          companyId: true,
          company: { select: { id: true, name: true, logoUrl: true } },
        },
        orderBy: { createdAt: 'asc' },
      })
    ),
  ['cliente-companies'],
  { revalidate: 300 }
)

export interface ClientePerfil {
  id: string
  nombre: string
  email: string
  telefono: string | null
  avatarUrl: string | null
  fechaNacimiento: Date | null
  ciudad: string | null
  genero: string | null
  notifPromos: boolean
  notifRecordatorios: boolean
  companyId: string
  company: { id: string; name: string; slug: string; type: string; logoUrl: string | null }
  vehiculos: {
    id: string
    marca: string
    modelo: string
    anio: number
    color: string
    placa: string | null
  }[]
}

/**
 * Datos del cliente para la página de perfil: básicos + empresa + vehículos.
 *
 * DEGRADACIÓN CONTROLADA: si la BD no tiene alguna columna nueva del select
 * (deploy adelantado a las migraciones — schema drift), NO se rompe la página:
 * se reintenta con el núcleo estable de columnas y se rellenan las nuevas con
 * defaults. El log deja el remedio exacto (`npm run db:doctor`).
 */
export async function getClientePerfil(clienteId: string): Promise<ClientePerfil | null> {
  if (!clienteId) {
    console.warn('[getClientePerfil] Missing clienteId')
    return null
  }

  // Núcleo estable: columnas originales del modelo, presentes desde el inicio.
  const selectBase = {
    id: true,
    nombre: true,
    email: true,
    telefono: true,
    companyId: true,
    company: {
      select: { id: true, name: true, slug: true, type: true, logoUrl: true },
    },
    vehiculos: {
      orderBy: { createdAt: 'desc' as const },
      select: { id: true, marca: true, modelo: true, anio: true, color: true, placa: true },
    },
  }

  try {
    return await sinEmpresa('cliente: mi perfil', (tx) =>
      tx.cliente.findUnique({
        where: { id: clienteId },
        select: {
          ...selectBase,
          avatarUrl: true,
          fechaNacimiento: true,
          ciudad: true,
          genero: true,
          notifPromos: true,
          notifRecordatorios: true,
        },
      })
    )
  } catch (error) {
    const { logErrorBd } = await import('@/lib/prisma-errors')
    const info = logErrorBd('getClientePerfil', error, { clienteId })
    // Solo tiene sentido reintentar si el problema es una columna faltante:
    // el select reducido evita las columnas nuevas y la página sigue viva.
    if (info.tipo !== 'SCHEMA_DRIFT') throw error

    const base = await sinEmpresa('cliente: mi perfil (select base)', (tx) =>
      tx.cliente.findUnique({
        where: { id: clienteId },
        select: selectBase,
      })
    )
    if (!base) return null
    return {
      ...base,
      avatarUrl: null,
      fechaNacimiento: null,
      ciudad: null,
      genero: null,
      notifPromos: true,
      notifRecordatorios: true,
    }
  }
}

export interface VisitaHistorial {
  id: string
  servicio: string
  fechaVisita: Date
  descontado: boolean
  notas: string | null
  sucursal: string | null
  empleado: string | null
  planNombre: string | null
  vehiculo: { marca: string; modelo: string; placa: string | null } | null
  /** Fase E4: registro oficial de la operación (si la visita generó uno). */
  transaccion: { codigo: string; ticketNumero: string; estado: string } | null
}

/** Un vehículo del cliente, con lo que la pantalla de "Mis vehículos" enseña. */
export interface VehiculoCliente {
  id: string
  marca: string
  modelo: string
  anio: number
  color: string
  placa: string | null
  esPrincipal: boolean
  /** Categoría del catálogo (Sedán, SUV…), si se registró. */
  categoria: string | null
  /** Membresías a las que está asociado: por qué borrarlo no es trivial. */
  membresias: { id: string; planNombre: string; empresaNombre: string }[]
}

/**
 * Vehículos del cliente para su pantalla propia (§41).
 *
 * Consulta APARTE de `getClientePerfil` a propósito: aquella alimenta el
 * perfil y solo necesita marca/modelo/año para un resumen, mientras que esta
 * pantalla enseña además la categoría, cuál es el principal y a qué
 * membresías está asociado cada uno. Cargar todo eso en el perfil sería pagar
 * dos joins en una pantalla que no los muestra.
 */
export async function getVehiculosCliente(clienteId: string): Promise<VehiculoCliente[]> {
  try {
    const filas = await sinEmpresa('cliente: mis vehículos', (tx) =>
      tx.vehiculo.findMany({
        where: { clienteId },
        orderBy: [{ esPrincipal: 'desc' }, { createdAt: 'desc' }],
        select: {
          id: true,
          marca: true,
          modelo: true,
          anio: true,
          color: true,
          placa: true,
          esPrincipal: true,
          tipoVehiculo: { select: { nombre: true } },
          membresias: {
            select: {
              membership: {
                select: {
                  id: true,
                  plan: { select: { nombre: true } },
                  company: { select: { name: true } },
                },
              },
            },
          },
        },
      })
    )

    return filas.map((v) => ({
      id: v.id,
      marca: v.marca,
      modelo: v.modelo,
      anio: v.anio,
      color: v.color,
      placa: v.placa,
      esPrincipal: v.esPrincipal,
      categoria: v.tipoVehiculo?.nombre ?? null,
      membresias: v.membresias
        .map((mv) => mv.membership)
        .filter((m): m is NonNullable<typeof m> => Boolean(m))
        .map((m) => ({
          id: m.id,
          planNombre: m.plan?.nombre ?? 'Plan',
          empresaNombre: m.company?.name ?? '',
        })),
    }))
  } catch (e) {
    // La pantalla degrada a "sin vehículos" en vez de romperse: es informativa.
    console.error('[cliente-vehiculos]', e)
    return []
  }
}

export interface HistorialVisitas {
  total: number
  pages: number
  esteMes: number
  visitas: VisitaHistorial[]
}

export async function getClienteVisitas(
  clienteId: string,
  page = 1,
  pageSize = 20
): Promise<HistorialVisitas> {
  const skip = (page - 1) * pageSize
  const inicioMes = new Date()
  inicioMes.setDate(1)
  inicioMes.setHours(0, 0, 0, 0)

  const [total, esteMes, visitas] = await sinEmpresa('cliente: mi historial de visitas', (tx) =>
    Promise.all([
      tx.visit.count({ where: { clienteId } }),
      tx.visit.count({ where: { clienteId, fechaVisita: { gte: inicioMes } } }),
      tx.visit.findMany({
        where: { clienteId },
        select: {
          id: true,
          servicio: true,
          fechaVisita: true,
          descontado: true,
          notas: true,
          sucursal: { select: { nombre: true } },
          empleado: { select: { name: true } },
          membership: { select: { plan: { select: { nombre: true } } } },
          vehiculo: { select: { marca: true, modelo: true, placa: true } },
          transaccion: { select: { codigo: true, ticketNumero: true, estado: true } },
        },
        orderBy: { fechaVisita: 'desc' },
        skip,
        take: pageSize,
      }),
    ])
  )

  return {
    total,
    esteMes,
    pages: Math.ceil(total / pageSize),
    visitas: visitas.map((v) => ({
      id: v.id,
      servicio: v.servicio,
      fechaVisita: v.fechaVisita,
      descontado: v.descontado,
      notas: v.notas,
      sucursal: v.sucursal?.nombre ?? null,
      empleado: v.empleado?.name ?? null,
      planNombre: v.membership?.plan?.nombre ?? null,
      vehiculo: v.vehiculo
        ? { marca: v.vehiculo.marca, modelo: v.vehiculo.modelo, placa: v.vehiculo.placa }
        : null,
      transaccion: v.transaccion
        ? { codigo: v.transaccion.codigo, ticketNumero: v.transaccion.ticketNumero, estado: v.transaccion.estado }
        : null,
    })),
  }
}

export function activeMembership<
  T extends { estado: string; fechaVencimiento: Date | null }
>(memberships: T[]): T | undefined {
  return memberships.find(
    (m) =>
      m.estado === 'ACTIVA' &&
      (!m.fechaVencimiento || m.fechaVencimiento > new Date())
  )
}

/**
 * Membresía activa "principal" del cliente (la de vencimiento más lejano):
 * destino del FAB "Mi QR". null = sin membresía activa (el FAB se oculta).
 */
export async function getMembresiaActivaPrincipalId(
  supabaseId: string,
  clienteId?: string | null
): Promise<string | null> {
  if (!supabaseId && !clienteId) return null
  try {
    const or = [
      ...(supabaseId ? [{ supabaseId }] : []),
      ...(clienteId ? [{ id: clienteId }] : []),
    ]
    const m = await sinEmpresa('cliente: membresía activa principal', (tx) =>
      tx.membership.findFirst({
        where: {
          estado: 'ACTIVA',
          OR: [{ fechaVencimiento: null }, { fechaVencimiento: { gt: new Date() } }],
          cliente: { OR: or },
        },
        orderBy: { fechaVencimiento: 'desc' },
        select: { id: true },
      })
    )
    return m?.id ?? null
  } catch (e) {
    console.error('[getMembresiaActivaPrincipalId]', e)
    return null
  }
}

export interface BeneficioDisponible {
  id: string
  titulo: string
  empresa: string
  usosRestantes: number
  usosIncluidos: number
}

/**
 * MOB · El beneficio ACTIVO más reciente del cliente con usos disponibles:
 * protagonista del Home ("🎁 disponible — Usar ahora"). null = nada que usar.
 */
/**
 * EL BENEFICIO LISTO PARA USAR DEL INICIO — de la PERSONA, no de la empresa
 * que tenga abierta.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * FILTRABA POR LA FICHA ACTIVA
 *
 * Recibía `clienteId` —la ficha de la empresa activa— y buscaba solo ahí. Una
 * recompensa reclamada en otro negocio se adquiría bien, se guardaba bien, y
 * el inicio seguía diciendo que no había nada listo para usar.
 *
 * Es el MISMO fallo que tenía «Mis beneficios» y que se arregló al habilitar
 * reclamar en cualquier empresa. Aquí seguía vivo, y el inicio es la primera
 * pantalla que alguien mira: el sitio donde más se nota que falta algo.
 *
 * Ahora mira todas las fichas de la persona (`misClienteIds`). Sigue acotado
 * —solo lo suyo—; lo que cambia es que «lo suyo» ya no depende de qué negocio
 * tuviera seleccionado.
 */
export async function getBeneficioDisponible(
  supabaseId?: string | null
): Promise<BeneficioDisponible | null> {
  if (!supabaseId) return null
  try {
    const clienteIds = await misClienteIds(supabaseId)
    if (clienteIds.length === 0) return null
    const compra = await sinEmpresa('cliente: beneficio disponible', (tx) =>
      tx.productoCompra.findFirst({
        where: { clienteId: { in: clienteIds }, estado: 'ACTIVA', usosRestantes: { gt: 0 } },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          usosRestantes: true,
          usosIncluidos: true,
          promocion: { select: { titulo: true } },
          company: { select: { name: true } },
        },
      })
    )
    if (!compra?.promocion) return null
    return {
      id: compra.id,
      titulo: compra.promocion.titulo,
      empresa: compra.company.name,
      usosRestantes: compra.usosRestantes,
      usosIncluidos: compra.usosIncluidos,
    }
  } catch (e) {
    console.error('[getBeneficioDisponible]', e)
    return null
  }
}

export interface PagoHistorialItem {
  id: string
  tipo: 'APROBADO' | 'RECHAZADO'
  fecha: Date
  monto: number | null
  motivo: string | null
  planNombre: string | null
  /** Método de pago de la membresía de esa transacción (ej. "Banco Popular"). */
  metodoPagoNombre: string | null
  /** Comprobante subido para esa membresía (para el visor integrado). */
  comprobanteUrl: string | null
  /** Nombre del miembro del equipo que aprobó/rechazó el pago. */
  validadoPor: string | null
}

export interface ClientePagos {
  membership: {
    id: string
    estado: string
    planNombre: string
    montoPagado: number | null
    fechaInicio: Date | null
    fechaVencimiento: Date | null
    createdAt: Date
    comprobanteUrl: string | null
    comprobanteNota: string | null
    rechazadoReason: string | null
    metodoPagoNombre: string | null
    planSolicitadoNombre: string | null
  } | null
  historial: PagoHistorialItem[]
}

/**
 * Datos de "Mis pagos": estado actual de la membresía + historial real de pagos
 * (aprobados/rechazados) reconstruido desde el AuditLog. Devuelve datos planos.
 */
export async function getClientePagos(clienteId: string): Promise<ClientePagos> {
  const memberships = await sinEmpresa('cliente: mis membresías y pagos', (tx) =>
    tx.membership.findMany({
      where: { clienteId },
      include: { plan: true, metodoPago: true, planSolicitado: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
  )

  const membershipIds = memberships.map((m) => m.id)
  const current = memberships[0] ?? null

  let historial: PagoHistorialItem[] = []
  if (membershipIds.length > 0) {
    try {
      const logs = await sinEmpresa('cliente: historial de pagos (auditLog)', (tx) =>
        tx.auditLog.findMany({
          where: {
            entidadTipo: 'Membership',
            entidadId: { in: membershipIds },
            accion: { in: ['PAGO_APROBADO', 'PAGO_RECHAZADO'] },
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
        })
      )

      // Resolver nombres de plan referenciados en los payloads.
      const planIds = new Set<string>()
      for (const l of logs) {
        const p = (l.payload ?? {}) as Record<string, unknown>
        if (typeof p.planId === 'string') planIds.add(p.planId)
        if (typeof p.planNuevo === 'string') planIds.add(p.planNuevo)
      }
      const planes = planIds.size
        ? await sinEmpresa('cliente: resolver nombres de planes', (tx) =>
            tx.plan.findMany({
              where: { id: { in: [...planIds] } },
              select: { id: true, nombre: true },
            })
          )
        : []
      const planName = new Map(planes.map((p) => [p.id, p.nombre]))

      // Método de pago y comprobante por membresía (constancia de la
      // transacción en el extracto) + nombre del staff que la validó.
      const membershipInfo = new Map(
        memberships.map((mem) => [
          mem.id,
          {
            metodoPagoNombre: mem.metodoPago?.nombre ?? null,
            comprobanteUrl: mem.comprobanteUrl ?? null,
          },
        ])
      )
      const validadorIds = [...new Set(logs.map((l) => l.userId).filter((u): u is string => !!u))]
      const validadores = validadorIds.length
        ? await sinEmpresa('cliente: resolver validadores', (tx) =>
            tx.user
              .findMany({
                where: { id: { in: validadorIds } },
                select: { id: true, name: true },
              })
          )
            .catch(() => [])
        : []
      const validadorName = new Map(validadores.map((u) => [u.id, u.name]))

      historial = logs.map((l) => {
        const p = (l.payload ?? {}) as Record<string, unknown>
        const planRef =
          (typeof p.planNuevo === 'string' && p.planNuevo) ||
          (typeof p.planId === 'string' && p.planId) ||
          null
        const info = membershipInfo.get(l.entidadId ?? '') ?? null
        return {
          id: l.id,
          tipo: l.accion === 'PAGO_APROBADO' ? 'APROBADO' : 'RECHAZADO',
          fecha: l.createdAt,
          monto: typeof p.monto === 'number' ? p.monto : null,
          motivo: typeof p.motivo === 'string' ? p.motivo : null,
          planNombre: planRef ? planName.get(planRef) ?? null : null,
          metodoPagoNombre: info?.metodoPagoNombre ?? null,
          comprobanteUrl: info?.comprobanteUrl ?? null,
          validadoPor: l.userId ? validadorName.get(l.userId) ?? null : null,
        }
      })
    } catch (e) {
      console.error('[getClientePagos] historial', e)
    }
  }

  return {
    membership: current
      ? {
          id: current.id,
          estado: current.estado,
          planNombre: current.plan.nombre,
          montoPagado: current.montoPagado != null ? Number(current.montoPagado) : null,
          fechaInicio: current.fechaInicio,
          fechaVencimiento: current.fechaVencimiento,
          createdAt: current.createdAt,
          comprobanteUrl: current.comprobanteUrl,
          comprobanteNota: current.comprobanteNota,
          rechazadoReason: current.rechazadoReason,
          metodoPagoNombre: current.metodoPago?.nombre ?? null,
          planSolicitadoNombre:
            current.estado === 'ACTIVA' && current.planIdSolicitado
              ? current.planSolicitado?.nombre ?? null
              : null,
        }
      : null,
    historial,
  }
}
