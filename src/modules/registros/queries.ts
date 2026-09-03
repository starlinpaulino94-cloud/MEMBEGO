import type { Prisma } from '@prisma/client'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { armarCsv } from '@/lib/csv'
import { normalizarBusqueda } from '@/modules/busqueda/normalizar'

/**
 * Registros / Comprobantes (Control de comprobantes · Fase 3 · G7+G10).
 *
 * Vista unificada de TODAS las transacciones del ledger (ventas, usos de
 * membresía, promociones, beneficios, canjes, referidos…), con filtros por
 * tipo, estado, método de cobro y rango de fechas, más un resumen agregado.
 * Reutiliza `obtenerTicket`/`FacturaPrintDialog` para reimprimir cualquier
 * comprobante y `registrosToCsv` para exportar. Multi-tenant por companyId.
 */

export const TIPO_LABEL: Record<string, string> = {
  SALE: 'Venta',
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

export const ESTADO_LABEL: Record<string, string> = {
  PENDING: 'Pendiente',
  VALIDATING: 'Validando',
  APPROVED: 'Aprobada',
  APPLIED: 'Aplicada',
  CANCELLED: 'Cancelada',
  REVERTED: 'Revertida',
  EXPIRED: 'Expirada',
  ERROR: 'Error',
}

export const METODO_LABEL: Record<string, string> = {
  EFECTIVO: 'Efectivo',
  TRANSFERENCIA: 'Transferencia',
  OTRO: 'Otro',
}

export interface RegistroFiltro {
  q?: string
  tipo?: string
  estado?: string
  metodo?: string
  desde?: string
  hasta?: string
}

export interface RegistroItem {
  id: string
  codigo: string
  ticketNumero: string
  tipo: string
  tipoLabel: string
  estado: string
  estadoLabel: string
  cliente: string | null
  detalle: string | null
  empleado: string | null
  sucursal: string | null
  metodoCobro: string | null
  monto: number | null
  fecha: string
  impresiones: number
  esEntrega: boolean
}

export interface RegistrosResumen {
  cantidad: number
  total: number
  porMetodo: { efectivo: number; transferencia: number; otro: number }
  porTipo: { tipo: string; label: string; cantidad: number; total: number }[]
}

export interface RegistrosResultado {
  items: RegistroItem[]
  resumen: RegistrosResumen
  /**
   * @deprecated Ya no se trunca: la tabla es paginada y `total` permite
   * alcanzar CUALQUIER registro. Se conserva en falso por compatibilidad.
   */
  truncado: boolean
  /** Total real de registros que cumplen el filtro (para paginar). */
  total: number
  timeZone: string
}

const TIPOS_VALIDOS = new Set(Object.keys(TIPO_LABEL))
const ESTADOS_VALIDOS = new Set(Object.keys(ESTADO_LABEL))
const METODOS_VALIDOS = new Set(Object.keys(METODO_LABEL))

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

/** Instante UTC de medianoche local de un día `YYYY-MM-DD` (inicio o fin). */
function limiteDiaLocal(fecha: string, timeZone: string, fin: boolean): Date {
  const baseUtc = new Date(`${fecha}T00:00:00Z`).getTime()
  const offset = tzOffsetMin(new Date(`${fecha}T12:00:00Z`), timeZone)
  const startUtc = baseUtc - offset * 60000
  return new Date(fin ? startUtc + 86_400_000 : startUtc)
}

/** Construye el `where` de Prisma a partir de los filtros saneados. */
function construirWhere(
  companyId: string | undefined,
  f: RegistroFiltro,
  timeZone: string
): Prisma.TransactionWhereInput {
  const term = (f.q ?? '').trim()
  const tipo = f.tipo && TIPOS_VALIDOS.has(f.tipo) ? f.tipo : undefined
  const estado = f.estado && ESTADOS_VALIDOS.has(f.estado) ? f.estado : undefined
  const metodo = f.metodo && METODOS_VALIDOS.has(f.metodo) ? f.metodo : undefined
  const desde = /^\d{4}-\d{2}-\d{2}$/.test(f.desde ?? '') ? (f.desde as string) : undefined
  const hasta = /^\d{4}-\d{2}-\d{2}$/.test(f.hasta ?? '') ? (f.hasta as string) : undefined

  const createdAt: Prisma.DateTimeFilter = {}
  if (desde) createdAt.gte = limiteDiaLocal(desde, timeZone, false)
  if (hasta) createdAt.lt = limiteDiaLocal(hasta, timeZone, true)

  return {
    ...(companyId ? { companyId } : {}),
    ...(tipo ? { tipo: tipo as Prisma.EnumTransactionTipoFilter } : {}),
    ...(estado ? { estado: estado as Prisma.EnumTransactionEstadoFilter } : {}),
    ...(metodo ? { metodoCobro: { equals: metodo as never } } : {}),
    ...(desde || hasta ? { createdAt } : {}),
    ...(term
      ? {
          OR: [
            { codigo: { contains: term.toUpperCase() } },
            { ticketNumero: { contains: term.toUpperCase() } },
            { cliente: { nombreBusqueda: { contains: normalizarBusqueda(term) } } },
          ],
        }
      : {}),
  }
}

const MAX_TABLA = 300
const MAX_EXPORT = 5000

function mapItem(t: {
  id: string
  codigo: string
  ticketNumero: string
  tipo: string
  estado: string
  metodoCobro: string | null
  monto: Prisma.Decimal | null
  createdAt: Date
  snapshot: Prisma.JsonValue
  cliente: { nombre: string } | null
  sucursal: { nombre: string } | null
  empleado: { name: string | null } | null
  _count: { impresiones: number }
}): RegistroItem {
  const snap = (t.snapshot ?? {}) as { detalle?: string; empleado?: string; esEntrega?: boolean }
  return {
    id: t.id,
    codigo: t.codigo,
    ticketNumero: t.ticketNumero,
    tipo: t.tipo,
    tipoLabel: TIPO_LABEL[t.tipo] ?? t.tipo,
    estado: t.estado,
    estadoLabel: ESTADO_LABEL[t.estado] ?? t.estado,
    cliente: t.cliente?.nombre ?? null,
    detalle: snap.detalle ?? null,
    empleado: t.empleado?.name ?? snap.empleado ?? null,
    sucursal: t.sucursal?.nombre ?? null,
    metodoCobro: t.metodoCobro,
    monto: t.monto == null ? null : Number(t.monto),
    fecha: t.createdAt.toISOString(),
    impresiones: t._count.impresiones,
    esEntrega: snap.esEntrega === true,
  }
}

const INCLUDE = {
  cliente: { select: { nombre: true } },
  sucursal: { select: { nombre: true } },
  empleado: { select: { name: true } },
  _count: { select: { impresiones: true } },
} as const

/** Consulta sobre el ledger: con tenant si hay empresa, global si no. */
function ledger<T>(
  companyId: string | undefined,
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return companyId
    ? conEmpresa(companyId, fn)
    : sinEmpresa('registros: ledger global sin empresa', fn)
}

/**
 * Registros filtrados + resumen agregado. El resumen se calcula sobre TODAS las
 * transacciones que cumplen el filtro (hasta MAX_EXPORT), aunque la tabla solo
 * muestre las primeras MAX_TABLA. `timeZone` para formatear e interpretar días.
 */
export async function getRegistros(
  companyId: string | undefined,
  filtro: RegistroFiltro,
  timeZone: string,
  /**
   * Ventana de la página. Omitirla mantiene el comportamiento antiguo (primeras
   * filas), para los llamadores que aún no paginan.
   */
  ventana?: { saltar: number; tomar: number }
): Promise<RegistrosResultado> {
  const where = construirWhere(companyId, filtro, timeZone)

  const [rows, agregados, totalFilas] = await ledger(companyId, (tx) =>
    Promise.all([
      tx.transaction.findMany({
        where,
        include: INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: ventana?.saltar ?? 0,
        take: ventana ? Math.min(ventana.tomar, MAX_TABLA) : MAX_TABLA,
      }),
      // Resumen: se agregan solo las APLICADAS con monto (ingresos reales),
      // por método y por tipo, en JS sobre un conjunto acotado.
      tx.transaction.findMany({
        where: { ...where, estado: 'APPLIED', monto: { not: null } },
        select: { monto: true, metodoCobro: true, tipo: true },
        take: MAX_EXPORT,
      }),
      // Total real del filtro: es lo que permite navegar a CUALQUIER página.
      tx.transaction.count({ where }),
    ])
  )

  const items = rows.map(mapItem)

  const porMetodo = { efectivo: 0, transferencia: 0, otro: 0 }
  const tipoMap = new Map<string, { cantidad: number; total: number }>()
  let total = 0
  for (const a of agregados) {
    const monto = Number(a.monto ?? 0)
    total += monto
    if (a.metodoCobro === 'EFECTIVO') porMetodo.efectivo += monto
    else if (a.metodoCobro === 'TRANSFERENCIA') porMetodo.transferencia += monto
    else porMetodo.otro += monto
    const t = tipoMap.get(a.tipo) ?? { cantidad: 0, total: 0 }
    t.cantidad += 1
    t.total += monto
    tipoMap.set(a.tipo, t)
  }

  return {
    items,
    truncado: false,
    total: totalFilas,
    timeZone,
    resumen: {
      cantidad: agregados.length,
      total,
      porMetodo,
      porTipo: [...tipoMap.entries()]
        .map(([tipo, v]) => ({ tipo, label: TIPO_LABEL[tipo] ?? tipo, ...v }))
        .sort((a, b) => b.total - a.total),
    },
  }
}

/** Filas completas (hasta MAX_EXPORT) para exportar a CSV, sin resumen. */
export async function getRegistrosParaExport(
  companyId: string | undefined,
  filtro: RegistroFiltro,
  timeZone: string
): Promise<RegistroItem[]> {
  const where = construirWhere(companyId, filtro, timeZone)
  const rows = await ledger(companyId, (tx) =>
    tx.transaction.findMany({
      where,
      include: INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: MAX_EXPORT,
    })
  )
  return rows.map(mapItem)
}

/**
 * Serializa registros a CSV.
 *
 * Por `armarCsv` (`lib/csv.ts`), que es la única puerta: este archivo tenía su
 * propio escapado y unía con coma, así que en Excel es-DO las doce columnas
 * llegaban metidas en la primera.
 */
export function registrosToCsv(items: RegistroItem[], timeZone: string): string {
  const fmtFecha = (iso: string) =>
    new Intl.DateTimeFormat('es-DO', {
      timeZone,
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(iso))

  return armarCsv(
    [
      'Fecha',
      'Ticket',
      'Codigo',
      'Tipo',
      'Estado',
      'Cliente',
      'Detalle',
      'Empleado',
      'Sucursal',
      'Metodo',
      'Monto',
      'Impresiones',
    ],
    items.map((i) => [
      fmtFecha(i.fecha),
      i.ticketNumero,
      i.codigo,
      i.tipoLabel,
      i.estadoLabel,
      i.cliente,
      i.detalle,
      i.empleado,
      i.sucursal,
      i.metodoCobro ? METODO_LABEL[i.metodoCobro] ?? i.metodoCobro : '',
      i.monto == null ? '' : i.monto.toFixed(2),
      i.impresiones,
    ])
  )
}
