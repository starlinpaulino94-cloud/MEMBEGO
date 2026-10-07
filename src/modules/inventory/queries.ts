import type { InventoryMovementType, InventoryReservationStatus } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { normalizarCapacidades } from '@/modules/catalog/domain'
import { disponible, estadoDeStock, type EstadoStock } from './domain'

/**
 * COMMERCE CORE · inventario — lecturas para el panel (Fase 2).
 *
 * Solo lectura, siempre dentro de `conEmpresa` y filtradas por `companyId`
 * (el aislamiento no depende de que la RLS esté encendida). Lo que se lista son
 * las variantes de los productos que CONTROLAN inventario: un servicio no
 * aparece aquí aunque esté en el catálogo.
 */

/** Tope de variantes que una lista trae a memoria: pasado eso se filtra por texto o sucursal. */
export const MAX_VARIANTES_LISTA = 2000
export const POR_PAGINA = 30

export interface SucursalSaldo {
  sucursalId: string
  nombre: string
  activa: boolean
  nivelId: string | null
  onHand: number
  reserved: number
  damaged: number
  disponible: number
  lowStockThreshold: number
  estado: EstadoStock
}

export interface FilaInventario {
  varianteId: string
  sku: string
  nombreVariante: string
  esDefault: boolean
  itemId: string
  itemNombre: string
  itemEstado: string
  onHand: number
  reserved: number
  damaged: number
  disponible: number
  estado: EstadoStock
  /** Sucursales con saldo registrado (las demás son «sin existencias»). */
  sucursales: SucursalSaldo[]
}

export type FiltroEstado = 'TODOS' | 'BAJO' | 'AGOTADO'

export interface FiltrosInventario {
  q?: string
  sucursalId?: string
  estado?: FiltroEstado
  pagina?: number
}

export interface ListaInventario {
  filas: FilaInventario[]
  total: number
  pagina: number
  paginas: number
  /** true si había más variantes que MAX_VARIANTES_LISTA y la lista se recortó. */
  recortada: boolean
  /** Cuántas variantes hay en cada estado (antes de filtrar por estado), para los resúmenes. */
  conteos: Record<EstadoStock, number>
}

const ORDEN_ESTADO: Record<EstadoStock, number> = { AGOTADO: 0, BAJO: 1, OK: 2 }

/**
 * El estado de una variante: AGOTADA si no suma nada vendible en ninguna
 * sucursal; BAJA si alguna sucursal con umbral llegó a él (aunque otra tenga
 * de sobra: ahí es donde falta); OK en el resto.
 */
function estadoDeVariante(saldos: SucursalSaldo[]): EstadoStock {
  const totalDisponible = saldos.reduce((s, x) => s + x.disponible, 0)
  if (totalDisponible <= 0) return 'AGOTADO'
  if (saldos.some((s) => s.lowStockThreshold > 0 && s.estado !== 'OK')) return 'BAJO'
  return 'OK'
}

export async function listarInventarioEnTx(tx: Tx, companyId: string, f: FiltrosInventario = {}): Promise<ListaInventario> {
  const q = f.q?.trim()
  const variantes = await tx.catalogVariant.findMany({
    where: {
      companyId,
      status: { not: 'DISCONTINUED' },
      item: { status: { not: 'ARCHIVED' }, capabilities: { path: ['trackInventory'], equals: true } },
      ...(q
        ? { OR: [{ sku: { contains: q, mode: 'insensitive' } }, { name: { contains: q, mode: 'insensitive' } }, { item: { name: { contains: q, mode: 'insensitive' } } }] }
        : {}),
    },
    select: {
      id: true,
      sku: true,
      name: true,
      isDefault: true,
      item: { select: { id: true, name: true, status: true } },
      inventoryLevels: {
        where: { companyId, ...(f.sucursalId ? { locationId: f.sucursalId } : {}) },
        select: { id: true, locationId: true, onHand: true, reserved: true, damaged: true, lowStockThreshold: true, location: { select: { nombre: true, activa: true } } },
      },
    },
    orderBy: [{ item: { name: 'asc' } }, { position: 'asc' }, { id: 'asc' }],
    take: MAX_VARIANTES_LISTA + 1,
  })
  const recortada = variantes.length > MAX_VARIANTES_LISTA
  if (recortada) variantes.pop()

  const todas: FilaInventario[] = variantes.map((v) => {
    const sucursales: SucursalSaldo[] = v.inventoryLevels
      .map((n) => ({
        sucursalId: n.locationId,
        nombre: n.location.nombre,
        activa: n.location.activa,
        nivelId: n.id,
        onHand: n.onHand,
        reserved: n.reserved,
        damaged: n.damaged,
        disponible: disponible(n),
        lowStockThreshold: n.lowStockThreshold,
        estado: estadoDeStock(n),
      }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
    const total = sucursales.reduce(
      (t, s) => ({ onHand: t.onHand + s.onHand, reserved: t.reserved + s.reserved, damaged: t.damaged + s.damaged }),
      { onHand: 0, reserved: 0, damaged: 0 }
    )
    return {
      varianteId: v.id,
      sku: v.sku,
      nombreVariante: v.name,
      esDefault: v.isDefault,
      itemId: v.item.id,
      itemNombre: v.item.name,
      itemEstado: v.item.status,
      ...total,
      disponible: total.onHand - total.reserved,
      estado: estadoDeVariante(sucursales),
      sucursales,
    }
  })

  const conteos: Record<EstadoStock, number> = { AGOTADO: 0, BAJO: 0, OK: 0 }
  for (const x of todas) conteos[x.estado]++
  const filtradas = f.estado && f.estado !== 'TODOS' ? todas.filter((x) => x.estado === f.estado) : todas
  // Lo que pide atención va primero; dentro de cada estado, el orden alfabético que ya traía.
  const ordenadas = [...filtradas].sort((a, b) => ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado])
  const paginas = Math.max(1, Math.ceil(ordenadas.length / POR_PAGINA))
  const pagina = Math.min(Math.max(1, Math.trunc(f.pagina ?? 1) || 1), paginas)
  return { filas: ordenadas.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA), total: ordenadas.length, pagina, paginas, recortada, conteos }
}

export interface SucursalOpcion {
  id: string
  nombre: string
}

/** Las sucursales abiertas de la empresa, para el filtro y los selectores. */
export async function sucursalesActivasEnTx(tx: Tx, companyId: string): Promise<SucursalOpcion[]> {
  const s = await tx.sucursal.findMany({ where: { companyId, activa: true }, select: { id: true, nombre: true }, orderBy: [{ nombre: 'asc' }, { id: 'asc' }] })
  return s
}

// ── Alertas de stock bajo ────────────────────────────────────────────────────

export interface AlertaStock {
  nivelId: string
  varianteId: string
  sku: string
  itemNombre: string
  nombreVariante: string
  esDefault: boolean
  sucursalNombre: string
  disponible: number
  lowStockThreshold: number
  estado: Exclude<EstadoStock, 'OK'>
}

export interface ResumenAlertas {
  alertas: AlertaStock[]
  /** Cuántas hay en total (la lista se recorta a `limite`). */
  total: number
}

/**
 * Saldos que llegaron a su umbral (o se agotaron teniendo umbral). Sin umbral no
 * hay alerta: la alerta es una promesa que la empresa hizo al configurarla.
 */
export async function alertasDeStockEnTx(tx: Tx, companyId: string, limite = 10): Promise<ResumenAlertas> {
  // `disponible <= umbral` compara dos columnas, y Prisma no lo expresa: se
  // traen los saldos CON umbral (pocos) y se decide aquí con el dominio.
  const niveles = await tx.inventoryLevel.findMany({
    where: {
      companyId,
      lowStockThreshold: { gt: 0 },
      variant: { status: { not: 'DISCONTINUED' }, item: { status: { not: 'ARCHIVED' }, capabilities: { path: ['trackInventory'], equals: true } } },
    },
    select: {
      id: true,
      onHand: true,
      reserved: true,
      lowStockThreshold: true,
      location: { select: { nombre: true } },
      variant: { select: { id: true, sku: true, name: true, isDefault: true, item: { select: { name: true } } } },
    },
  })
  const todas: AlertaStock[] = []
  for (const n of niveles) {
    const estado = estadoDeStock(n)
    if (estado === 'OK') continue
    todas.push({
      nivelId: n.id,
      varianteId: n.variant.id,
      sku: n.variant.sku,
      itemNombre: n.variant.item.name,
      nombreVariante: n.variant.name,
      esDefault: n.variant.isDefault,
      sucursalNombre: n.location.nombre,
      disponible: disponible(n),
      lowStockThreshold: n.lowStockThreshold,
      estado,
    })
  }
  // Primero lo agotado, luego lo que queda menos respecto de su umbral.
  todas.sort((a, b) => ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado] || a.disponible / a.lowStockThreshold - b.disponible / b.lowStockThreshold)
  return { alertas: todas.slice(0, limite), total: todas.length }
}

// ── Detalle de una variante ──────────────────────────────────────────────────

export interface DetalleVarianteInventario {
  varianteId: string
  sku: string
  nombreVariante: string
  esDefault: boolean
  itemId: string
  itemNombre: string
  controlaInventario: boolean
  /** Todas las sucursales activas (con o sin saldo) más las inactivas que aún tengan existencias. */
  sucursales: SucursalSaldo[]
}

export async function detalleVarianteEnTx(tx: Tx, companyId: string, varianteId: string): Promise<DetalleVarianteInventario | null> {
  const v = await tx.catalogVariant.findFirst({
    where: { id: varianteId, companyId },
    select: {
      id: true,
      sku: true,
      name: true,
      isDefault: true,
      item: { select: { id: true, name: true, type: true, capabilities: true } },
      inventoryLevels: { where: { companyId }, select: { id: true, locationId: true, onHand: true, reserved: true, damaged: true, lowStockThreshold: true } },
    },
  })
  if (!v) return null
  const sucursales = await tx.sucursal.findMany({ where: { companyId }, select: { id: true, nombre: true, activa: true }, orderBy: [{ nombre: 'asc' }, { id: 'asc' }] })
  const porSucursal = new Map(v.inventoryLevels.map((n) => [n.locationId, n]))
  const filas: SucursalSaldo[] = []
  for (const s of sucursales) {
    const n = porSucursal.get(s.id)
    const conExistencias = n ? n.onHand > 0 || n.damaged > 0 : false
    if (!s.activa && !conExistencias) continue
    const base = n ?? { id: null, onHand: 0, reserved: 0, damaged: 0, lowStockThreshold: 0 }
    filas.push({
      sucursalId: s.id,
      nombre: s.nombre,
      activa: s.activa,
      nivelId: base.id,
      onHand: base.onHand,
      reserved: base.reserved,
      damaged: base.damaged,
      disponible: disponible(base),
      lowStockThreshold: base.lowStockThreshold,
      estado: estadoDeStock(base),
    })
  }
  return {
    varianteId: v.id,
    sku: v.sku,
    nombreVariante: v.name,
    esDefault: v.isDefault,
    itemId: v.item.id,
    itemNombre: v.item.name,
    controlaInventario: normalizarCapacidades(v.item.type, v.item.capabilities).trackInventory,
    sucursales: filas,
  }
}

// ── Historial ────────────────────────────────────────────────────────────────

export interface FilaMovimiento {
  id: string
  creadoEn: Date
  tipo: InventoryMovementType
  cantidad: number
  /** +cantidad si aumenta lo que hay, −cantidad si baja, 0 si solo cambia de cubeta. */
  efectoOnHand: number
  previousOnHand: number
  newOnHand: number
  motivo: string | null
  sucursalNombre: string
  usuarioNombre: string | null
  referenciaTipo: string | null
  referenciaId: string | null
}

export interface HistorialPagina {
  filas: FilaMovimiento[]
  /** Cursor para pedir la página siguiente, o null si no hay más. */
  siguiente: string | null
}

export const POR_PAGINA_HISTORIAL = 25

/**
 * Los movimientos de una variante (todas las sucursales), del más reciente al
 * más antiguo. Paginado por cursor (`createdAt|id`), no por offset: el ledger
 * crece sin parar y un offset se vuelve lento y se corre si entran filas nuevas.
 */
export async function historialDeVarianteEnTx(tx: Tx, companyId: string, varianteId: string, cursor?: string | null): Promise<HistorialPagina> {
  let antes: { creadoEn: Date; id: string } | null = null
  if (cursor) {
    const [t, id] = cursor.split('|')
    const fecha = new Date(t)
    if (id && !Number.isNaN(fecha.getTime())) antes = { creadoEn: fecha, id }
  }
  const movs = await tx.inventoryMovement.findMany({
    where: {
      companyId,
      level: { catalogVariantId: varianteId },
      ...(antes ? { OR: [{ createdAt: { lt: antes.creadoEn } }, { createdAt: antes.creadoEn, id: { lt: antes.id } }] } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: POR_PAGINA_HISTORIAL + 1,
    select: {
      id: true,
      createdAt: true,
      type: true,
      quantity: true,
      previousOnHand: true,
      newOnHand: true,
      reason: true,
      userId: true,
      referenceType: true,
      referenceId: true,
      level: { select: { location: { select: { nombre: true } } } },
    },
  })
  const hayMas = movs.length > POR_PAGINA_HISTORIAL
  const pagina = hayMas ? movs.slice(0, POR_PAGINA_HISTORIAL) : movs
  const ids = [...new Set(pagina.map((m) => m.userId).filter((x): x is string => Boolean(x)))]
  const usuarios = ids.length ? await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : []
  const nombres = new Map(usuarios.map((u) => [u.id, u.name || u.email]))
  const ultimo = pagina[pagina.length - 1]
  return {
    filas: pagina.map((m) => ({
      id: m.id,
      creadoEn: m.createdAt,
      tipo: m.type,
      cantidad: m.quantity,
      efectoOnHand: m.newOnHand - m.previousOnHand,
      previousOnHand: m.previousOnHand,
      newOnHand: m.newOnHand,
      motivo: m.reason,
      sucursalNombre: m.level.location.nombre,
      usuarioNombre: m.userId ? (nombres.get(m.userId) ?? null) : null,
      referenciaTipo: m.referenceType,
      referenciaId: m.referenceId,
    })),
    siguiente: hayMas && ultimo ? `${ultimo.createdAt.toISOString()}|${ultimo.id}` : null,
  }
}

export interface ReservaVista {
  id: string
  sucursalNombre: string
  cantidad: number
  estado: InventoryReservationStatus
  expiresAt: Date
  referenciaTipo: string | null
  referenciaId: string | null
}

/** Reservas vivas de una variante: lo que hoy está apartado y hasta cuándo. */
export async function reservasVivasEnTx(tx: Tx, companyId: string, varianteId: string, ahora: Date = new Date()): Promise<ReservaVista[]> {
  const rs = await tx.inventoryReservation.findMany({
    where: { companyId, status: 'ACTIVE', expiresAt: { gt: ahora }, level: { catalogVariantId: varianteId } },
    orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
    take: 50,
    select: { id: true, quantity: true, status: true, expiresAt: true, referenceType: true, referenceId: true, level: { select: { location: { select: { nombre: true } } } } },
  })
  return rs.map((r) => ({
    id: r.id,
    sucursalNombre: r.level.location.nombre,
    cantidad: r.quantity,
    estado: r.status,
    expiresAt: r.expiresAt,
    referenciaTipo: r.referenceType,
    referenciaId: r.referenceId,
  }))
}
