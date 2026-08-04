import { conEmpresa, sinEmpresa } from '@/lib/tenant'

/**
 * Caja (POS) · consultas del turno y búsqueda de órdenes pendientes.
 * Multi-tenant: TODO se filtra por companyId del staff autenticado.
 */

/** Sesión ABIERTA de una sucursal (una como máximo por diseño). */
export async function getCajaAbierta(sucursalId: string) {
  const sucursal = await sinEmpresa('caja: lookup de sucursal para conocer su empresa', (tx) =>
    tx.sucursal.findUnique({ where: { id: sucursalId }, select: { companyId: true } })
  )
  if (!sucursal) return null
  return conEmpresa(sucursal.companyId, (tx) =>
    tx.cajaSesion.findFirst({
      where: { sucursalId, estado: 'ABIERTA' },
      include: {
        sucursal: { select: { id: true, nombre: true } },
        abiertaPor: { select: { id: true, name: true } },
      },
      orderBy: { abiertaAt: 'desc' },
    })
  )
}

export async function getSucursalesActivas(companyId: string) {
  return conEmpresa(companyId, (tx) =>
    tx.sucursal.findMany({
      where: { companyId, activa: true },
      select: { id: true, nombre: true, direccion: true },
      orderBy: { nombre: 'asc' },
    })
  )
}

export interface ResumenSesion {
  cobros: number
  totalEfectivo: number
  totalTransferencia: number
  totalOtro: number
  total: number
  ultimos: {
    id: string
    codigo: string
    clienteNombre: string
    detalle: string
    monto: number
    metodoCobro: string | null
    createdAt: Date
    /** true = ya tiene impresión original (la siguiente sale como COPIA). */
    impresa: boolean
  }[]
}

/** Ventas del turno: totales por método + últimos cobros de la sesión. */
export async function getResumenSesion(cajaSesionId: string): Promise<ResumenSesion> {
  const sesion = await sinEmpresa('caja: lookup de sesión para conocer su empresa', (tx) =>
    tx.cajaSesion.findUnique({ where: { id: cajaSesionId }, select: { companyId: true } })
  )
  if (!sesion) {
    return { cobros: 0, totalEfectivo: 0, totalTransferencia: 0, totalOtro: 0, total: 0, ultimos: [] }
  }
  const cobros = await conEmpresa(sesion.companyId, (tx) =>
    tx.transaction.findMany({
      where: { cajaSesionId, estado: 'APPLIED' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        codigo: true,
        monto: true,
        metodoCobro: true,
        snapshot: true,
        createdAt: true,
        cliente: { select: { nombre: true } },
        _count: { select: { impresiones: true } },
      },
    })
  )

  const sum = (metodo: string) =>
    cobros
      .filter((c) => c.metodoCobro === metodo)
      .reduce((acc, c) => acc + Number(c.monto ?? 0), 0)

  return {
    cobros: cobros.length,
    totalEfectivo: sum('EFECTIVO'),
    totalTransferencia: sum('TRANSFERENCIA'),
    totalOtro: sum('OTRO'),
    total: cobros.reduce((acc, c) => acc + Number(c.monto ?? 0), 0),
    ultimos: cobros.slice(0, 15).map((c) => {
      const snap = (c.snapshot ?? {}) as { detalle?: string }
      return {
        id: c.id,
        codigo: c.codigo,
        clienteNombre: c.cliente?.nombre ?? 'Cliente',
        detalle: snap.detalle ?? '',
        monto: Number(c.monto ?? 0),
        metodoCobro: c.metodoCobro,
        createdAt: c.createdAt,
        impresa: c._count.impresiones > 0,
      }
    }),
  }
}

export interface MovimientosSesion {
  entrada: number
  salida: number
  neto: number
  items: { id: string; tipo: 'ENTRADA' | 'SALIDA'; concepto: string; monto: number; createdAt: Date; registradoPor: string | null }[]
}

/** Movimientos de efectivo (G9) de una sesión: entradas, salidas y neto. */
export async function getMovimientosSesion(cajaSesionId: string): Promise<MovimientosSesion> {
  const sesion = await sinEmpresa('caja: lookup de sesión para conocer su empresa', (tx) =>
    tx.cajaSesion.findUnique({ where: { id: cajaSesionId }, select: { companyId: true } })
  )
  if (!sesion) return { entrada: 0, salida: 0, neto: 0, items: [] }
  const movs = await conEmpresa(sesion.companyId, (tx) =>
    tx.movimientoCaja.findMany({
      where: { cajaSesionId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, tipo: true, concepto: true, monto: true, createdAt: true, registradoPor: true },
    })
  )
  let entrada = 0
  let salida = 0
  for (const m of movs) {
    if (m.tipo === 'ENTRADA') entrada += Number(m.monto)
    else salida += Number(m.monto)
  }
  return {
    entrada,
    salida,
    neto: entrada - salida,
    items: movs.map((m) => ({
      id: m.id,
      tipo: m.tipo,
      concepto: m.concepto,
      monto: Number(m.monto),
      createdAt: m.createdAt,
      registradoPor: m.registradoPor,
    })),
  }
}

// ── Cierre de caja (Z-report) ────────────────────────────────────────────────

/** Etiquetas legibles de los tipos de transacción en el cierre. */
const TIPO_LABEL: Record<string, string> = {
  SALE: 'Ventas',
  MEMBERSHIP_REDEMPTION: 'Uso de membresía',
  PROMOTION_USE: 'Uso de promoción',
  BENEFIT_USE: 'Entrega de beneficio',
  REWARD_REDEMPTION: 'Canje de premio',
  COUPON_USE: 'Cupón',
  POINTS_SPEND: 'Puntos',
  REFERRAL: 'Referido',
  PURCHASE: 'Compra',
  OTHER: 'Otro',
}

export interface CierreReporte {
  id: string
  sucursal: string
  turno: string | null
  estado: string
  abiertaPor: string
  cerradaPor: string | null
  abiertaAt: Date
  cerradaAt: Date | null
  balanceInicial: number
  balanceFinal: number | null
  balanceEsperado: number | null
  diferencia: number | null
  observaciones: string | null
  cobros: number
  total: number
  porMetodo: { efectivo: number; transferencia: number; otro: number }
  porTipo: { tipo: string; label: string; cantidad: number; total: number }[]
  porEmpleado: { empleado: string; cantidad: number; total: number }[]
  /** Movimientos de efectivo intra-turno (G9): entradas y salidas. */
  movimientos: { tipo: 'ENTRADA' | 'SALIDA'; concepto: string; monto: number; fecha: Date }[]
  movimientosEntrada: number
  movimientosSalida: number
  empresa: {
    nombre: string
    logoUrl: string | null
    direccion: string | null
    telefono: string | null
  }
  timeZone: string
}

/**
 * Reporte de cierre de una sesión de caja (arqueo "Z"): datos del turno +
 * cobros desglosados por método, por tipo de operación y por empleado. Sirve
 * para imprimir y reimprimir. Filtra por companyId (multi-tenant).
 */
export async function getCierreReporte(
  cajaSesionId: string,
  companyId: string
): Promise<CierreReporte | null> {
  const sesion = await conEmpresa(companyId, (tx) =>
    tx.cajaSesion.findFirst({
      where: { id: cajaSesionId, companyId },
      include: {
        sucursal: { select: { nombre: true } },
        abiertaPor: { select: { name: true } },
        cerradaPor: { select: { name: true } },
        company: {
          select: {
            name: true,
            logoUrl: true,
            direccion: true,
            telefono: true,
            zonaHoraria: true,
          },
        },
      },
    })
  )
  if (!sesion) return null

  const [cobros, movimientos] = await conEmpresa(companyId, (tx) =>
    Promise.all([
      tx.transaction.findMany({
        where: { cajaSesionId, estado: 'APPLIED' },
        select: {
          monto: true,
          metodoCobro: true,
          tipo: true,
          empleado: { select: { name: true } },
        },
      }),
      tx.movimientoCaja.findMany({
        where: { cajaSesionId },
        select: { tipo: true, concepto: true, monto: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
    ])
  )

  let movimientosEntrada = 0
  let movimientosSalida = 0
  for (const m of movimientos) {
    const monto = Number(m.monto)
    if (m.tipo === 'ENTRADA') movimientosEntrada += monto
    else movimientosSalida += monto
  }

  const porMetodo = { efectivo: 0, transferencia: 0, otro: 0 }
  const tipoMap = new Map<string, { cantidad: number; total: number }>()
  const empMap = new Map<string, { cantidad: number; total: number }>()
  let total = 0

  for (const c of cobros) {
    const monto = Number(c.monto ?? 0)
    total += monto
    if (c.metodoCobro === 'EFECTIVO') porMetodo.efectivo += monto
    else if (c.metodoCobro === 'TRANSFERENCIA') porMetodo.transferencia += monto
    else porMetodo.otro += monto

    const t = tipoMap.get(c.tipo) ?? { cantidad: 0, total: 0 }
    t.cantidad += 1
    t.total += monto
    tipoMap.set(c.tipo, t)

    const nombre = c.empleado?.name ?? 'Sin asignar'
    const e = empMap.get(nombre) ?? { cantidad: 0, total: 0 }
    e.cantidad += 1
    e.total += monto
    empMap.set(nombre, e)
  }

  return {
    id: sesion.id,
    sucursal: sesion.sucursal.nombre,
    turno: sesion.turno,
    estado: sesion.estado,
    abiertaPor: sesion.abiertaPor.name ?? '—',
    cerradaPor: sesion.cerradaPor?.name ?? null,
    abiertaAt: sesion.abiertaAt,
    cerradaAt: sesion.cerradaAt,
    balanceInicial: Number(sesion.balanceInicial),
    balanceFinal: sesion.balanceFinal == null ? null : Number(sesion.balanceFinal),
    balanceEsperado: sesion.balanceEsperado == null ? null : Number(sesion.balanceEsperado),
    diferencia: sesion.diferencia == null ? null : Number(sesion.diferencia),
    observaciones: sesion.observaciones,
    cobros: cobros.length,
    total,
    porMetodo,
    porTipo: [...tipoMap.entries()]
      .map(([tipo, v]) => ({ tipo, label: TIPO_LABEL[tipo] ?? tipo, ...v }))
      .sort((a, b) => b.total - a.total),
    porEmpleado: [...empMap.entries()]
      .map(([empleado, v]) => ({ empleado, ...v }))
      .sort((a, b) => b.total - a.total),
    movimientos: movimientos.map((m) => ({
      tipo: m.tipo,
      concepto: m.concepto,
      monto: Number(m.monto),
      fecha: m.createdAt,
    })),
    movimientosEntrada,
    movimientosSalida,
    empresa: {
      nombre: sesion.company.name,
      logoUrl: sesion.company.logoUrl,
      direccion: sesion.company.direccion,
      telefono: sesion.company.telefono,
    },
    timeZone: sesion.company.zonaHoraria,
  }
}

export interface CierreListItem {
  id: string
  sucursal: string
  turno: string | null
  cerradaAt: Date | null
  cerradaPor: string | null
  balanceFinal: number | null
  diferencia: number | null
}

/** Últimos cierres de caja de la empresa, para imprimir/reimprimir. */
export async function getCierresRecientes(
  companyId: string,
  limit = 8
): Promise<CierreListItem[]> {
  const sesiones = await conEmpresa(companyId, (tx) =>
    tx.cajaSesion.findMany({
      where: { companyId, estado: 'CERRADA' },
      orderBy: { cerradaAt: 'desc' },
      take: limit,
      include: {
        sucursal: { select: { nombre: true } },
        cerradaPor: { select: { name: true } },
      },
    })
  )
  return sesiones.map((s) => ({
    id: s.id,
    sucursal: s.sucursal.nombre,
    turno: s.turno,
    cerradaAt: s.cerradaAt,
    cerradaPor: s.cerradaPor?.name ?? null,
    balanceFinal: s.balanceFinal == null ? null : Number(s.balanceFinal),
    diferencia: s.diferencia == null ? null : Number(s.diferencia),
  }))
}

// ── Reporte por empleado / día (incluye transferencias del panel) ────────────

/** Minutos que la zona horaria va por delante de UTC en un instante dado. */
function tzOffsetMin(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const map: Record<string, number> = {}
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== 'literal') map[p.type] = Number(p.value)
  }
  const asUTC = Date.UTC(map.year, map.month - 1, map.day, map.hour, map.minute, map.second)
  return (asUTC - date.getTime()) / 60000
}

/** Rango [gte, lt) en UTC del día calendario `YYYY-MM-DD` en una zona horaria. */
function rangoDiaLocal(fecha: string, timeZone: string): { gte: Date; lt: Date } {
  const baseUtc = new Date(`${fecha}T00:00:00Z`).getTime()
  const offset = tzOffsetMin(new Date(`${fecha}T12:00:00Z`), timeZone)
  const startUtc = baseUtc - offset * 60000
  return { gte: new Date(startUtc), lt: new Date(startUtc + 86_400_000) }
}

/** "YYYY-MM-DD" de hoy en la zona horaria dada. */
export function hoyLocal(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export interface ReporteEmpleadoDia {
  empleado: string
  fecha: string
  estado: 'CON_DATOS' | 'VACIO'
  cobros: number
  total: number
  porMetodo: { efectivo: number; transferencia: number; otro: number }
  porTipo: { tipo: string; label: string; cantidad: number; total: number }[]
  /** Desglose por origen: caja (turno) vs panel (transferencias/confirmaciones). */
  porOrigen: { caja: number; cajaTotal: number; panel: number; panelTotal: number }
  empresa: {
    nombre: string
    logoUrl: string | null
    direccion: string | null
    telefono: string | null
  }
  timeZone: string
}

/**
 * Cuadre del día de UN empleado: TODOS los cobros que aplicó ese día, con o sin
 * caja abierta. A diferencia del cierre de caja (atado a la sesión), este suma
 * también las **transferencias/pagos confirmados desde el panel** (G5), que no
 * pasan por una `CajaSesion`. Filtra por companyId (multi-tenant).
 */
export async function getReporteEmpleadoDia(
  companyId: string,
  empleadoId: string,
  empleadoNombre: string,
  fecha: string,
  timeZone: string
): Promise<ReporteEmpleadoDia> {
  const empresa = await conEmpresa(companyId, (tx) =>
    tx.company.findUnique({
      where: { id: companyId },
      select: { name: true, logoUrl: true, direccion: true, telefono: true },
    })
  )

  const { gte, lt } = rangoDiaLocal(fecha, timeZone)
  const cobros = await conEmpresa(companyId, (tx) =>
    tx.transaction.findMany({
      where: {
        companyId,
        empleadoId,
        estado: 'APPLIED',
        metodoCobro: { not: null },
        createdAt: { gte, lt },
      },
      select: { monto: true, metodoCobro: true, tipo: true, cajaSesionId: true },
    })
  )

  const porMetodo = { efectivo: 0, transferencia: 0, otro: 0 }
  const porOrigen = { caja: 0, cajaTotal: 0, panel: 0, panelTotal: 0 }
  const tipoMap = new Map<string, { cantidad: number; total: number }>()
  let total = 0

  for (const c of cobros) {
    const monto = Number(c.monto ?? 0)
    total += monto
    if (c.metodoCobro === 'EFECTIVO') porMetodo.efectivo += monto
    else if (c.metodoCobro === 'TRANSFERENCIA') porMetodo.transferencia += monto
    else porMetodo.otro += monto

    if (c.cajaSesionId) {
      porOrigen.caja += 1
      porOrigen.cajaTotal += monto
    } else {
      porOrigen.panel += 1
      porOrigen.panelTotal += monto
    }

    const t = tipoMap.get(c.tipo) ?? { cantidad: 0, total: 0 }
    t.cantidad += 1
    t.total += monto
    tipoMap.set(c.tipo, t)
  }

  return {
    empleado: empleadoNombre,
    fecha,
    estado: cobros.length === 0 ? 'VACIO' : 'CON_DATOS',
    cobros: cobros.length,
    total,
    porMetodo,
    porOrigen,
    porTipo: [...tipoMap.entries()]
      .map(([tipo, v]) => ({ tipo, label: TIPO_LABEL[tipo] ?? tipo, ...v }))
      .sort((a, b) => b.total - a.total),
    empresa: {
      nombre: empresa?.name ?? 'MembeGo',
      logoUrl: empresa?.logoUrl ?? null,
      direccion: empresa?.direccion ?? null,
      telefono: empresa?.telefono ?? null,
    },
    timeZone,
  }
}

export interface OrdenPendiente {
  /** MEMBRESIA = pago de plan (o cambio de plan); PROMOCION = compra. */
  tipo: 'MEMBRESIA' | 'PROMOCION'
  id: string
  referencia: string | null
  estado: string
  clienteNombre: string
  clienteTelefono: string | null
  clienteEmail: string | null
  detalle: string
  monto: number
  sucursalPago: string | null
  createdAt: Date
}

/** Estados de membresía con pago pendiente de cobrar en caja. */
const MEMBRESIA_COBRABLE = ['PENDIENTE', 'PENDIENTE_PAGO', 'RECHAZADA'] as const
/** Estados de compra de promoción con pago pendiente. */
const COMPRA_COBRABLE = ['SOLICITADA', 'PENDIENTE_PAGO', 'EN_VALIDACION', 'RECHAZADA'] as const

/**
 * Búsqueda de órdenes pendientes por referencia, nombre, teléfono o correo.
 * Sin término, devuelve las más recientes (cola de pendientes).
 */
export async function buscarOrdenesPendientes(
  companyId: string,
  q: string,
  limit = 20
): Promise<OrdenPendiente[]> {
  const term = q.trim()
  const filtroCliente = term
    ? {
        OR: [
          { nombre: { contains: term, mode: 'insensitive' as const } },
          { telefono: { contains: term } },
          { email: { contains: term, mode: 'insensitive' as const } },
        ],
      }
    : {}
  const filtroReferencia = term ? { referencia: { equals: term.toUpperCase() } } : null

  const [memberships, compras] = await conEmpresa(companyId, (tx) =>
    Promise.all([
      tx.membership.findMany({
        where: {
          cliente: { companyId, ...(filtroReferencia ? {} : filtroCliente) },
          ...(filtroReferencia
            ? { OR: [filtroReferencia, { cliente: { companyId, ...filtroCliente } }] }
            : {}),
          OR: [
            { estado: { in: [...MEMBRESIA_COBRABLE] } },
            // Cambio de plan pendiente de pago (membresía sigue ACTIVA).
            { estado: 'ACTIVA', planIdSolicitado: { not: null } },
          ],
        },
        include: {
          cliente: { select: { nombre: true, telefono: true, email: true } },
          plan: { select: { nombre: true, precio: true } },
          planSolicitado: { select: { nombre: true, precio: true } },
          sucursalPago: { select: { nombre: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: limit,
      }),
      tx.productoCompra.findMany({
        where: {
          companyId,
          estado: { in: [...COMPRA_COBRABLE] },
          ...(filtroReferencia
            ? { OR: [filtroReferencia, { cliente: filtroCliente }] }
            : { cliente: filtroCliente }),
        },
        include: {
          cliente: { select: { nombre: true, telefono: true, email: true } },
          promocion: { select: { titulo: true, precio: true } },
          sucursalPago: { select: { nombre: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: limit,
      }),
    ])
  )

  const ordenes: OrdenPendiente[] = [
    ...memberships.map((m): OrdenPendiente => {
      const esCambio = m.estado === 'ACTIVA' && m.planIdSolicitado != null
      const plan = esCambio ? m.planSolicitado : m.plan
      const descuento = m.fechaInicio == null ? Number(m.descuentoBienvenida ?? 0) : 0
      return {
        tipo: 'MEMBRESIA',
        id: m.id,
        referencia: m.referencia,
        estado: esCambio ? 'CAMBIO_PLAN' : m.estado,
        clienteNombre: m.cliente.nombre,
        clienteTelefono: m.cliente.telefono,
        clienteEmail: m.cliente.email,
        detalle: `${esCambio ? 'Cambio a ' : 'Plan '}${plan?.nombre ?? '—'}`,
        monto: Math.max(0, Number(plan?.precio ?? 0) - descuento),
        sucursalPago: m.sucursalPago?.nombre ?? null,
        createdAt: m.createdAt,
      }
    }),
    ...compras.map(
      (c): OrdenPendiente => ({
        tipo: 'PROMOCION',
        id: c.id,
        referencia: c.referencia,
        estado: c.estado,
        clienteNombre: c.cliente.nombre,
        clienteTelefono: c.cliente.telefono,
        clienteEmail: c.cliente.email,
        detalle: `Promoción ${c.promocion?.titulo ?? '—'}`,
        monto: Number(c.precioCongelado ?? c.promocion?.precio ?? 0),
        sucursalPago: c.sucursalPago?.nombre ?? null,
        createdAt: c.createdAt,
      })
    ),
  ]

  return ordenes
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit)
}
