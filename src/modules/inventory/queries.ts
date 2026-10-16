import { Prisma, type CatalogVariantStatus, type InventoryMovementType, type InventoryReservationStatus } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { normalizarCapacidades } from '@/modules/catalog/domain'
import { costoDeDecimal, formatearCosto, formatearMonto, valorDe } from './costos'
import { disponible, estadoDeStock, type EstadoStock } from './domain'
import { USUARIO_SISTEMA, armarCursor, esCodigoExacto, leerCursor, type FiltrosConteos, type FiltrosEntradas, type FiltrosMovimientos, type FiltrosTraslados } from './filtros'
import { pendienteDeLinea, type EstadoTraslado } from './traslados'
import { MAX_POR_CONTAR_VISIBLES, TOPE_FILAS_HOJA, claveDeLinea, type EstadoConteo } from './conteos'
import { limiteDiaLocal } from '@/modules/reportes/rango'
import { lotesDeMovimientosEnTx } from './lotes-queries'

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
  /** INV-3c · «Llenar hasta»: 0 = sin objetivo (no sale en Reposición). */
  targetStock: number
  estado: EstadoStock
}

export interface FilaInventario {
  varianteId: string
  sku: string
  /** Para reconocer una búsqueda exacta (lector de código de barras). */
  barcode: string | null
  nombreVariante: string
  esDefault: boolean
  itemId: string
  itemNombre: string
  itemEstado: string
  /** Lo que la empresa fijó a mano en el catálogo; manda sobre el inventario para vender. */
  estadoVariante: CatalogVariantStatus
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
  /**
   * La variante cuyo SKU o código de barras es EXACTAMENTE lo buscado, si hay una
   * sola. Es lo que hace un lector de código de barras: la pantalla salta a su ficha.
   */
  varianteExacta: string | null
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
        ? {
            OR: [
              { sku: { contains: q, mode: 'insensitive' } },
              { barcode: { contains: q, mode: 'insensitive' } },
              { name: { contains: q, mode: 'insensitive' } },
              { item: { name: { contains: q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      sku: true,
      barcode: true,
      status: true,
      name: true,
      isDefault: true,
      item: { select: { id: true, name: true, status: true } },
      inventoryLevels: {
        where: { companyId, ...(f.sucursalId ? { locationId: f.sucursalId } : {}) },
        select: { id: true, locationId: true, onHand: true, reserved: true, damaged: true, lowStockThreshold: true, targetStock: true, location: { select: { nombre: true, activa: true } } },
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
        targetStock: n.targetStock,
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
      barcode: v.barcode,
      nombreVariante: v.name,
      esDefault: v.isDefault,
      itemId: v.item.id,
      itemNombre: v.item.name,
      itemEstado: v.item.status,
      estadoVariante: v.status,
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
  const exactas = q ? todas.filter((x) => esCodigoExacto(q, x)) : []
  return {
    filas: ordenadas.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA),
    total: ordenadas.length,
    pagina,
    paginas,
    recortada,
    conteos,
    varianteExacta: exactas.length === 1 ? exactas[0].varianteId : null,
  }
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
  estadoVariante: CatalogVariantStatus
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
      status: true,
      item: { select: { id: true, name: true, type: true, capabilities: true } },
      inventoryLevels: { where: { companyId }, select: { id: true, locationId: true, onHand: true, reserved: true, damaged: true, lowStockThreshold: true, targetStock: true } },
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
    const base = n ?? { id: null, onHand: 0, reserved: 0, damaged: 0, lowStockThreshold: 0, targetStock: 0 }
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
      targetStock: base.targetStock,
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
    estadoVariante: v.status,
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
  /** INV-4b: el motivo del catálogo (solo ajustes y daños; null en todo lo anterior a INV-4b). */
  motivoCodigo: string | null
  sucursalNombre: string
  usuarioNombre: string | null
  referenciaTipo: string | null
  referenciaId: string | null
  /** INV-5a: de qué lotes es el movimiento («A-1 ×4, B ×2»). Solo lo llena el historial de un producto; null si no lleva lotes. */
  lotes?: string | null
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
      reasonCode: true,
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
  const lotes = await lotesDeMovimientosEnTx(tx, companyId, pagina.map((m) => m.id))
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
      motivoCodigo: m.reasonCode,
      sucursalNombre: m.level.location.nombre,
      usuarioNombre: m.userId ? (nombres.get(m.userId) ?? null) : null,
      referenciaTipo: m.referenceType,
      referenciaId: m.referenceId,
      lotes: lotes.get(m.id) ?? null,
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

// ── Movimientos de TODA la empresa ───────────────────────────────────────────

export const POR_PAGINA_MOVIMIENTOS = 50

export interface FilaMovimientoEmpresa extends FilaMovimiento {
  varianteId: string
  sku: string
  itemNombre: string
  nombreVariante: string
  esDefault: boolean
  sucursalId: string
}

export interface MovimientosEmpresaPagina {
  filas: FilaMovimientoEmpresa[]
  siguiente: string | null
}

/** La condición de fechas del filtro: días LOCALES de la empresa, ambos extremos incluidos. */
export function rangoDeFechas(f: Pick<FiltrosMovimientos, 'desde' | 'hasta'>, zonaHoraria: string): { gte?: Date; lt?: Date } {
  return {
    ...(f.desde ? { gte: limiteDiaLocal(f.desde, zonaHoraria, false) } : {}),
    ...(f.hasta ? { lt: limiteDiaLocal(f.hasta, zonaHoraria, true) } : {}),
  }
}

/**
 * Los movimientos de todas las variantes y sucursales de la empresa, del más
 * reciente al más antiguo, con los filtros de la pantalla. Paginado por cursor
 * (`createdAt|id`) por la misma razón que el historial de una variante: el
 * ledger crece sin parar y un offset se vuelve lento y se corre.
 *
 * `limite` es cuántas filas devolver; se pide una de más para saber si hay otra
 * página. La exportación usa esta MISMA función con un límite mayor, de modo que
 * el CSV y la pantalla no pueden diferir en qué filas cuentan.
 */
export async function movimientosEmpresaEnTx(
  tx: Tx,
  companyId: string,
  f: FiltrosMovimientos,
  opciones: { zonaHoraria: string; cursor?: string | null; limite?: number }
): Promise<MovimientosEmpresaPagina> {
  const limite = Math.max(1, Math.min(opciones.limite ?? POR_PAGINA_MOVIMIENTOS, 10_000))
  const antes = leerCursor(opciones.cursor)
  const q = f.q?.trim()
  const fechas = rangoDeFechas(f, opciones.zonaHoraria)
  const nivel: Prisma.InventoryLevelWhereInput = {
    ...(f.sucursalId ? { locationId: f.sucursalId } : {}),
    ...(q
      ? {
          variant: {
            OR: [
              { sku: { contains: q, mode: 'insensitive' } },
              { barcode: { contains: q, mode: 'insensitive' } },
              { name: { contains: q, mode: 'insensitive' } },
              { item: { name: { contains: q, mode: 'insensitive' } } },
            ],
          },
        }
      : {}),
  }
  const movs = await tx.inventoryMovement.findMany({
    where: {
      companyId,
      ...(f.tipo ? { type: f.tipo } : {}),
      ...(f.usuario ? { userId: f.usuario === USUARIO_SISTEMA ? null : f.usuario } : {}),
      ...(fechas.gte || fechas.lt ? { createdAt: fechas } : {}),
      ...(Object.keys(nivel).length > 0 ? { level: nivel } : {}),
      ...(antes ? { AND: [{ OR: [{ createdAt: { lt: antes.creadoEn } }, { createdAt: antes.creadoEn, id: { lt: antes.id } }] }] } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limite + 1,
    select: {
      id: true,
      createdAt: true,
      type: true,
      quantity: true,
      previousOnHand: true,
      newOnHand: true,
      reason: true,
      reasonCode: true,
      userId: true,
      referenceType: true,
      referenceId: true,
      level: {
        select: {
          locationId: true,
          location: { select: { nombre: true } },
          variant: { select: { id: true, sku: true, name: true, isDefault: true, item: { select: { name: true } } } },
        },
      },
    },
  })
  const hayMas = movs.length > limite
  const pagina = hayMas ? movs.slice(0, limite) : movs
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
      motivoCodigo: m.reasonCode,
      sucursalNombre: m.level.location.nombre,
      usuarioNombre: m.userId ? (nombres.get(m.userId) ?? null) : null,
      referenciaTipo: m.referenceType,
      referenciaId: m.referenceId,
      varianteId: m.level.variant.id,
      sku: m.level.variant.sku,
      itemNombre: m.level.variant.item.name,
      nombreVariante: m.level.variant.name,
      esDefault: m.level.variant.isDefault,
      sucursalId: m.level.locationId,
    })),
    siguiente: hayMas && ultimo ? armarCursor(ultimo.createdAt, ultimo.id) : null,
  }
}

export interface UsuarioOpcion {
  id: string
  nombre: string
}

/**
 * Las personas del equipo de la empresa, para el filtro «quién». Un
 * superadministrador que movió existencias desde fuera de la empresa no figura
 * aquí, pero sus movimientos SÍ salen en la lista con su nombre.
 */
export async function usuariosParaFiltroEnTx(tx: Tx, companyId: string): Promise<UsuarioOpcion[]> {
  const us = await tx.user.findMany({
    where: { companyId, role: { not: 'CLIENTE' } },
    select: { id: true, name: true, email: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: 200,
  })
  return us.map((u) => ({ id: u.id, nombre: u.name || u.email }))
}

// ── Reservas vivas de TODA la empresa ────────────────────────────────────────

/** Tope de filas de la pantalla de reservas: pasado eso se enseña el total y se pide filtrar. */
export const MAX_RESERVAS_LISTA = 200

export interface ReservaEmpresaVista {
  id: string
  varianteId: string
  sku: string
  itemNombre: string
  nombreVariante: string
  esDefault: boolean
  sucursalNombre: string
  cantidad: number
  expiresAt: Date
  referenciaTipo: string | null
  referenciaId: string | null
}

export interface ReservasEmpresa {
  filas: ReservaEmpresaVista[]
  /** Cuántas reservas vivas hay en total (la lista se recorta a `MAX_RESERVAS_LISTA`). */
  total: number
  /** Unidades apartadas en total por esas reservas. */
  unidades: number
}

/**
 * Lo que hoy está apartado en la empresa y hasta cuándo. «Vivas» = ACTIVE y NO
 * vencidas: una reserva pasada de hora ya no aparta nada aunque el barrido no
 * haya corrido (ver `service.ts`), así que no se cuenta aquí.
 */
export async function reservasVivasEmpresaEnTx(tx: Tx, companyId: string, ahora: Date = new Date()): Promise<ReservasEmpresa> {
  const [filas, suma, total] = await Promise.all([
    tx.inventoryReservation.findMany({
      where: { companyId, status: 'ACTIVE', expiresAt: { gt: ahora } },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      take: MAX_RESERVAS_LISTA,
      select: {
        id: true,
        quantity: true,
        expiresAt: true,
        referenceType: true,
        referenceId: true,
        level: {
          select: {
            location: { select: { nombre: true } },
            variant: { select: { id: true, sku: true, name: true, isDefault: true, item: { select: { name: true } } } },
          },
        },
      },
    }),
    tx.inventoryReservation.aggregate({ where: { companyId, status: 'ACTIVE', expiresAt: { gt: ahora } }, _sum: { quantity: true } }),
    tx.inventoryReservation.count({ where: { companyId, status: 'ACTIVE', expiresAt: { gt: ahora } } }),
  ])
  return {
    filas: filas.map((r) => ({
      id: r.id,
      varianteId: r.level.variant.id,
      sku: r.level.variant.sku,
      itemNombre: r.level.variant.item.name,
      nombreVariante: r.level.variant.name,
      esDefault: r.level.variant.isDefault,
      sucursalNombre: r.level.location.nombre,
      cantidad: r.quantity,
      expiresAt: r.expiresAt,
      referenciaTipo: r.referenceType,
      referenciaId: r.referenceId,
    })),
    total,
    unidades: suma._sum.quantity ?? 0,
  }
}

export interface SucursalFiltro {
  id: string
  nombre: string
  activa: boolean
}

/**
 * TODAS las sucursales de la empresa (también las desactivadas), para filtrar
 * movimientos: una sucursal que ya cerró sigue teniendo historial.
 */
export async function sucursalesDeLaEmpresaEnTx(tx: Tx, companyId: string): Promise<SucursalFiltro[]> {
  return tx.sucursal.findMany({ where: { companyId }, select: { id: true, nombre: true, activa: true }, orderBy: [{ nombre: 'asc' }, { id: 'asc' }] })
}

// ── INV-2a · Entradas de mercancía ───────────────────────────────────────────

export const POR_PAGINA_ENTRADAS = 30

export interface FilaEntrada {
  id: string
  numero: string
  creadoEn: Date
  sucursalId: string
  sucursalNombre: string
  origen: 'MANUAL' | 'CSV'
  referencia: string | null
  lineas: number
  unidades: number
  usuarioNombre: string | null
}

export interface EntradasPagina {
  filas: FilaEntrada[]
  siguiente: string | null
}

/** Nombres de las personas detrás de un conjunto de ids de usuario (los que ya no existen, no salen). */
export async function nombresDeUsuarios(tx: Tx, ids: readonly (string | null)[]): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter((x): x is string => Boolean(x)))]
  if (unicos.length === 0) return new Map()
  const us = await tx.user.findMany({ where: { id: { in: unicos } }, select: { id: true, name: true, email: true } })
  return new Map(us.map((u) => [u.id, u.name || u.email]))
}

/**
 * Las entradas de mercancía de la empresa, de la más reciente a la más antigua,
 * con los filtros de la pantalla. Paginado por cursor (`createdAt|id`).
 */
export async function entradasDeLaEmpresaEnTx(
  tx: Tx,
  companyId: string,
  f: FiltrosEntradas,
  opciones: { zonaHoraria: string; cursor?: string | null; limite?: number }
): Promise<EntradasPagina> {
  const limite = Math.max(1, Math.min(opciones.limite ?? POR_PAGINA_ENTRADAS, 200))
  const antes = leerCursor(opciones.cursor)
  const q = f.q?.trim()
  const fechas = rangoDeFechas(f, opciones.zonaHoraria)
  const filas = await tx.inventoryReceipt.findMany({
    where: {
      companyId,
      ...(f.sucursalId ? { locationId: f.sucursalId } : {}),
      ...(fechas.gte || fechas.lt ? { createdAt: fechas } : {}),
      ...(q ? { OR: [{ number: { contains: q, mode: 'insensitive' } }, { reference: { contains: q, mode: 'insensitive' } }] } : {}),
      ...(antes ? { AND: [{ OR: [{ createdAt: { lt: antes.creadoEn } }, { createdAt: antes.creadoEn, id: { lt: antes.id } }] }] } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limite + 1,
    select: {
      id: true,
      number: true,
      createdAt: true,
      locationId: true,
      source: true,
      reference: true,
      lineCount: true,
      unitCount: true,
      userId: true,
      location: { select: { nombre: true } },
    },
  })
  const hayMas = filas.length > limite
  const pagina = hayMas ? filas.slice(0, limite) : filas
  const nombres = await nombresDeUsuarios(tx, pagina.map((r) => r.userId))
  const ultimo = pagina[pagina.length - 1]
  return {
    filas: pagina.map((r) => ({
      id: r.id,
      numero: r.number,
      creadoEn: r.createdAt,
      sucursalId: r.locationId,
      sucursalNombre: r.location.nombre,
      origen: r.source,
      referencia: r.reference,
      lineas: r.lineCount,
      unidades: r.unitCount,
      usuarioNombre: r.userId ? (nombres.get(r.userId) ?? null) : null,
    })),
    siguiente: hayMas && ultimo ? armarCursor(ultimo.createdAt, ultimo.id) : null,
  }
}

export interface LineaDeEntrada {
  posicion: number
  varianteId: string
  sku: string
  barcode: string | null
  itemNombre: string
  nombreVariante: string
  esDefault: boolean
  cantidad: number
  existenciaAntes: number
  existenciaDespues: number
  /** INV-3a: costo unitario capturado, ya formateado; null = no se capturó. SOLO está si se pidió con `conCostos`. */
  costo?: string | null
  /** INV-5a: de qué lotes llegó («A-1 ×4, B ×2»); null si el producto no lleva lotes. */
  lotes?: string | null
}

export interface DetalleEntrada extends FilaEntrada {
  nota: string | null
  detalle: LineaDeEntrada[]
  /** INV-3a: lo que costó la entrada (solo las líneas con costo), ya formateado. SOLO está si se pidió con `conCostos`. */
  valorTotal?: string
  /** INV-3a: cuántas líneas no traen costo. SOLO está si se pidió con `conCostos`. */
  lineasSinCosto?: number
}

/** Una entrada con todas sus líneas; null si no existe o es de otra empresa (se ven igual a propósito). */
export async function entradaDetalleEnTx(tx: Tx, companyId: string, id: string, opciones: { conCostos?: boolean } = {}): Promise<DetalleEntrada | null> {
  if (typeof id !== 'string' || id === '' || id.length > 120) return null
  const r = await tx.inventoryReceipt.findFirst({
    where: { id, companyId },
    select: {
      id: true,
      number: true,
      createdAt: true,
      locationId: true,
      source: true,
      reference: true,
      note: true,
      lineCount: true,
      unitCount: true,
      userId: true,
      location: { select: { nombre: true } },
      lines: {
        orderBy: { position: 'asc' },
        select: {
          position: true,
          quantity: true,
          // El costo solo se lee si quien pregunta puede verlo: lo que no se lee no puede filtrarse.
          ...(opciones.conCostos ? { unitCost: true } : {}),
          variant: { select: { id: true, sku: true, barcode: true, name: true, isDefault: true, item: { select: { name: true } } } },
          movement: { select: { id: true, previousOnHand: true, newOnHand: true } },
        },
      },
    },
  })
  if (!r) return null
  const nombres = await nombresDeUsuarios(tx, [r.userId])
  const lotes = await lotesDeMovimientosEnTx(tx, companyId, r.lines.map((l) => l.movement.id))
  return {
    id: r.id,
    numero: r.number,
    creadoEn: r.createdAt,
    sucursalId: r.locationId,
    sucursalNombre: r.location.nombre,
    origen: r.source,
    referencia: r.reference,
    nota: r.note,
    lineas: r.lineCount,
    unidades: r.unitCount,
    usuarioNombre: r.userId ? (nombres.get(r.userId) ?? null) : null,
    detalle: r.lines.map((l) => ({
      posicion: l.position,
      varianteId: l.variant.id,
      sku: l.variant.sku,
      barcode: l.variant.barcode,
      itemNombre: l.variant.item.name,
      nombreVariante: l.variant.name,
      esDefault: l.variant.isDefault,
      cantidad: l.quantity,
      existenciaAntes: l.movement.previousOnHand,
      existenciaDespues: l.movement.newOnHand,
      lotes: lotes.get(l.movement.id) ?? null,
      ...(opciones.conCostos ? { costo: unitCostDe(l) === null ? null : formatearCosto(unitCostDe(l)!) } : {}),
    })),
    ...(opciones.conCostos
      ? {
          valorTotal: formatearMonto(r.lines.reduce((suma, l) => (unitCostDe(l) === null ? suma : suma + valorDe(l.quantity, unitCostDe(l)!)), BigInt(0))),
          lineasSinCosto: r.lines.filter((l) => unitCostDe(l) === null).length,
        }
      : {}),
  }
}

/** El costo unitario de una línea leída con `conCostos` (la consulta lo trae solo entonces); null = no se capturó. */
function unitCostDe(l: object): ReturnType<typeof costoDeDecimal> | null {
  const c = (l as { unitCost?: { toFixed(n: number): string } | null }).unitCost
  return c ? costoDeDecimal(c) : null
}

export interface VarianteBuscable {
  id: string
  sku: string
  barcode: string | null
  itemNombre: string
  nombreVariante: string
  esDefault: boolean
  /** Lo vendible hoy en la sucursal pedida (0 si no hay saldo); null si no se pidió sucursal. */
  disponible: number | null
  /** El texto buscado es EXACTAMENTE su SKU o su código de barras (lo que hace un lector). */
  exacto: boolean
  /** INV-5a: ¿lleva lotes? Entonces su línea de entrada dice de qué lotes es lo que llega. */
  llevaLotes: boolean
  /** INV-5a: ¿cada lote nuevo debe traer fecha de vencimiento? */
  exigeVencimiento: boolean
}

/**
 * Productos que controlan inventario, para añadir a una entrada: por nombre, SKU
 * o código de barras. Las coincidencias exactas de SKU o código van primero.
 */
export async function buscarVariantesParaEntradaEnTx(tx: Tx, companyId: string, q: string, sucursalId: string | null, limite = 10): Promise<VarianteBuscable[]> {
  const t = q.trim().slice(0, 80)
  if (t === '') return []
  const tope = Math.max(1, Math.min(limite, 30))
  // Lo común a las dos consultas; la empresa va ESCRITA en cada `where` (el guardia de aislamiento la busca ahí).
  const comun = {
    status: { not: 'DISCONTINUED' },
    item: { status: { not: 'ARCHIVED' }, capabilities: { path: ['trackInventory'], equals: true } },
  } satisfies Prisma.CatalogVariantWhereInput
  const select = {
    id: true,
    sku: true,
    barcode: true,
    name: true,
    isDefault: true,
    item: { select: { name: true } },
    inventoryLevels: { where: { companyId, ...(sucursalId ? { locationId: sucursalId } : { id: 'sin-sucursal' }) }, select: { onHand: true, reserved: true } },
    lotTracking: { where: { companyId }, select: { requiresExpiry: true } },
  } satisfies Prisma.CatalogVariantSelect
  // Dos consultas y no una: la coincidencia EXACTA (lo que escribe un lector) tiene que aparecer aunque haya mil
  // coincidencias parciales por delante en el orden alfabético.
  const [exactas, parciales] = await Promise.all([
    tx.catalogVariant.findMany({
      where: { companyId, ...comun, OR: [{ sku: { equals: t, mode: 'insensitive' } }, { barcode: { equals: t, mode: 'insensitive' } }] },
      select,
      take: tope,
    }),
    tx.catalogVariant.findMany({
      where: {
        companyId,
        ...comun,
        OR: [
          { sku: { contains: t, mode: 'insensitive' } },
          { barcode: { contains: t, mode: 'insensitive' } },
          { name: { contains: t, mode: 'insensitive' } },
          { item: { name: { contains: t, mode: 'insensitive' } } },
        ],
      },
      select,
      orderBy: [{ item: { name: 'asc' } }, { position: 'asc' }, { id: 'asc' }],
      take: tope,
    }),
  ])
  const vistos = new Set<string>()
  const salida: VarianteBuscable[] = []
  for (const v of [...exactas, ...parciales]) {
    if (vistos.has(v.id)) continue
    vistos.add(v.id)
    const nivel = v.inventoryLevels[0]
    salida.push({
      id: v.id,
      sku: v.sku,
      barcode: v.barcode,
      itemNombre: v.item.name,
      nombreVariante: v.name,
      esDefault: v.isDefault,
      disponible: sucursalId ? (nivel ? disponible(nivel) : 0) : null,
      exacto: esCodigoExacto(t, v),
      llevaLotes: v.lotTracking.length > 0,
      exigeVencimiento: v.lotTracking[0]?.requiresExpiry === true,
    })
  }
  return salida.slice(0, tope)
}

// ── INV-2b · Conteos físicos ─────────────────────────────────────────────────

export const POR_PAGINA_CONTEOS = 30

export interface FilaConteo {
  id: string
  numero: string
  estado: EstadoConteo
  sucursalId: string
  sucursalNombre: string
  nota: string | null
  creadoEn: Date
  aplicadoEn: Date | null
  canceladoEn: Date | null
  abiertoPorNombre: string | null
  /** Productos capturados: los de ahora si está abierto, los que se aplicaron si ya se aplicó. */
  lineas: number
  /** Solo en un conteo aplicado (resumen congelado). */
  ajustadas: number | null
  unidadesSobrantes: number | null
  unidadesFaltantes: number | null
  sinContar: number | null
}

export interface ConteosPagina {
  filas: FilaConteo[]
  siguiente: string | null
}

const SELECT_CONTEO = {
  id: true,
  number: true,
  status: true,
  locationId: true,
  note: true,
  createdAt: true,
  appliedAt: true,
  cancelledAt: true,
  openedById: true,
  countedLines: true,
  adjustedLines: true,
  unitsOver: true,
  unitsShort: true,
  uncountedLines: true,
  location: { select: { nombre: true } },
  _count: { select: { lines: true } },
} satisfies Prisma.InventoryCountSessionSelect

type ConteoCrudo = Prisma.InventoryCountSessionGetPayload<{ select: typeof SELECT_CONTEO }>

function filaDeConteo(r: ConteoCrudo, nombres: Map<string, string>): FilaConteo {
  return {
    id: r.id,
    numero: r.number,
    estado: r.status,
    sucursalId: r.locationId,
    sucursalNombre: r.location.nombre,
    nota: r.note,
    creadoEn: r.createdAt,
    aplicadoEn: r.appliedAt,
    canceladoEn: r.cancelledAt,
    abiertoPorNombre: r.openedById ? (nombres.get(r.openedById) ?? null) : null,
    lineas: r.status === 'APPLIED' ? (r.countedLines ?? r._count.lines) : r._count.lines,
    ajustadas: r.adjustedLines,
    unidadesSobrantes: r.unitsOver,
    unidadesFaltantes: r.unitsShort,
    sinContar: r.uncountedLines,
  }
}

/**
 * Los conteos de la empresa, del más reciente al más antiguo, con los filtros de
 * la pantalla. Paginado por cursor (`createdAt|id`) como movimientos y entradas.
 */
export async function conteosDeLaEmpresaEnTx(
  tx: Tx,
  companyId: string,
  f: FiltrosConteos,
  opciones: { zonaHoraria: string; cursor?: string | null; limite?: number }
): Promise<ConteosPagina> {
  const limite = Math.max(1, Math.min(opciones.limite ?? POR_PAGINA_CONTEOS, 200))
  const antes = leerCursor(opciones.cursor)
  const q = f.q?.trim()
  const fechas = rangoDeFechas(f, opciones.zonaHoraria)
  const filas = await tx.inventoryCountSession.findMany({
    where: {
      companyId,
      ...(f.sucursalId ? { locationId: f.sucursalId } : {}),
      ...(f.estado ? { status: f.estado } : {}),
      ...(fechas.gte || fechas.lt ? { createdAt: fechas } : {}),
      ...(q ? { OR: [{ number: { contains: q, mode: 'insensitive' } }, { note: { contains: q, mode: 'insensitive' } }] } : {}),
      ...(antes ? { AND: [{ OR: [{ createdAt: { lt: antes.creadoEn } }, { createdAt: antes.creadoEn, id: { lt: antes.id } }] }] } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limite + 1,
    select: SELECT_CONTEO,
  })
  const hayMas = filas.length > limite
  const pagina = hayMas ? filas.slice(0, limite) : filas
  const nombres = await nombresDeUsuarios(tx, pagina.map((r) => r.openedById))
  const ultimo = pagina[pagina.length - 1]
  return { filas: pagina.map((r) => filaDeConteo(r, nombres)), siguiente: hayMas && ultimo ? armarCursor(ultimo.createdAt, ultimo.id) : null }
}

export interface LineaDeConteo {
  varianteId: string
  /** INV-5b3: el lote que se contó (null en un producto sin lotes). Una línea es un producto o un producto en un lote. */
  loteId: string | null
  loteCodigo: string | null
  /** `YYYY-MM-DD` o null (el lote no vence, o la línea no es de un lote). */
  loteVencimiento: string | null
  sku: string
  barcode: string | null
  itemNombre: string
  nombreVariante: string
  esDefault: boolean
  contado: number
  /** Lo que decía el sistema al contar. null cuando se pide a ciegas (la pantalla de captura no lo recibe). */
  esperado: number | null
  contadoPorNombre: string | null
  contadoEn: Date
  /** Solo en un conteo aplicado: las existencias reales justo antes y justo después del ajuste. */
  existenciaAntes: number | null
  existenciaDespues: number | null
  ajustado: boolean
}

export interface DetalleConteo extends FilaConteo {
  aplicadoPorNombre: string | null
  canceladoPorNombre: string | null
  motivoCancelacion: string | null
  detalle: LineaDeConteo[]
}

/**
 * Un conteo con todas sus líneas; null si no existe o es de otra empresa (se ven
 * igual a propósito). `conEsperado: false` es el CONTEO A CIEGAS: lo que decía
 * el sistema ni siquiera sale de la base hacia la pantalla de captura, para que
 * nadie cuente «hasta que cuadre».
 */
export async function conteoDetalleEnTx(tx: Tx, companyId: string, id: string, opciones: { conEsperado: boolean }): Promise<DetalleConteo | null> {
  if (typeof id !== 'string' || id === '' || id.length > 120) return null
  const r = await tx.inventoryCountSession.findFirst({
    where: { id, companyId },
    select: {
      ...SELECT_CONTEO,
      appliedById: true,
      cancelledById: true,
      cancelReason: true,
      lines: {
        orderBy: [{ countedAt: 'desc' }, { id: 'desc' }],
        select: {
          catalogVariantId: true,
          lotId: true,
          lot: { select: { code: true, expiresOn: true } },
          counted: true,
          expected: true,
          countedById: true,
          countedAt: true,
          onHandBefore: true,
          onHandAfter: true,
          movementId: true,
          variant: { select: { sku: true, barcode: true, name: true, isDefault: true, item: { select: { name: true } } } },
        },
      },
    },
  })
  if (!r) return null
  const nombres = await nombresDeUsuarios(tx, [r.openedById, r.appliedById, r.cancelledById, ...r.lines.map((l) => l.countedById)])
  return {
    ...filaDeConteo(r, nombres),
    aplicadoPorNombre: r.appliedById ? (nombres.get(r.appliedById) ?? null) : null,
    canceladoPorNombre: r.cancelledById ? (nombres.get(r.cancelledById) ?? null) : null,
    motivoCancelacion: r.cancelReason,
    detalle: r.lines.map((l) => ({
      varianteId: l.catalogVariantId,
      loteId: l.lotId,
      loteCodigo: l.lot?.code ?? null,
      loteVencimiento: l.lot?.expiresOn ? l.lot.expiresOn.toISOString().slice(0, 10) : null,
      sku: l.variant.sku,
      barcode: l.variant.barcode,
      itemNombre: l.variant.item.name,
      nombreVariante: l.variant.name,
      esDefault: l.variant.isDefault,
      contado: l.counted,
      esperado: opciones.conEsperado ? l.expected : null,
      contadoPorNombre: l.countedById ? (nombres.get(l.countedById) ?? null) : null,
      contadoEn: l.countedAt,
      existenciaAntes: opciones.conEsperado ? l.onHandBefore : null,
      existenciaDespues: opciones.conEsperado ? l.onHandAfter : null,
      ajustado: l.movementId !== null,
    })),
  }
}

export interface ConteoAbierto {
  id: string
  numero: string
}

/** El conteo abierto de una sucursal, si hay (como mucho uno). */
export async function conteoAbiertoDeSucursalEnTx(tx: Tx, companyId: string, sucursalId: string): Promise<ConteoAbierto | null> {
  const r = await tx.inventoryCountSession.findFirst({ where: { companyId, locationId: sucursalId, status: 'OPEN' }, select: { id: true, number: true } })
  return r ? { id: r.id, numero: r.number } : null
}

export interface ProductoPorContar {
  varianteId: string
  /** INV-5b3: si el producto lleva lotes, cada lote con existencias es una línea por contar. */
  loteId: string | null
  loteCodigo: string | null
  loteVencimiento: string | null
  sku: string
  nombre: string
}

/**
 * Lo que tiene existencias en la sucursal del conteo y todavía no tiene línea: solo NOMBRES, sin cantidades (conteo a ciegas). Sirve
 * para no dejar pasillos sin contar. Un producto sin lotes es una línea por contar; uno con lotes, una por CADA LOTE con existencias
 * (contar un lote no cuenta los demás). El total siempre es exacto; la lista se acota.
 */
export async function porContarEnTx(tx: Tx, companyId: string, conteoId: string, sucursalId: string): Promise<{ total: number; items: ProductoPorContar[] }> {
  type Fila = { varianteId: string; loteId: string | null; loteCodigo: string | null; loteVencimiento: string | null; sku: string; nombre: string }
  const base = Prisma.sql`
    SELECT v."id" AS "varianteId", NULL::text AS "loteId", NULL::text AS "loteCodigo", NULL::text AS "loteVencimiento", v."sku" AS "sku",
           CASE WHEN v."isDefault" THEN i."name" ELSE i."name" || ' · ' || v."name" END AS "nombre", i."name" AS "orden1", v."position" AS "orden2", ''::text AS "orden3"
      FROM "inventory_levels" lv
      JOIN "catalog_variants" v ON v."id" = lv."catalogVariantId" AND v."companyId" = lv."companyId"
      JOIN "catalog_items" i ON i."id" = v."catalogItemId" AND i."companyId" = v."companyId"
     WHERE lv."companyId" = ${companyId} AND lv."locationId" = ${sucursalId} AND lv."onHand" > 0
       AND NOT EXISTS (SELECT 1 FROM "inventory_lot_tracking" t WHERE t."catalogVariantId" = lv."catalogVariantId")
       AND NOT EXISTS (SELECT 1 FROM "inventory_count_lines" cl WHERE cl."sessionId" = ${conteoId} AND cl."catalogVariantId" = lv."catalogVariantId")
    UNION ALL
    SELECT v."id", l."id", l."code", l."expiresOn"::text, v."sku",
           CASE WHEN v."isDefault" THEN i."name" ELSE i."name" || ' · ' || v."name" END, i."name", v."position", l."code"
      FROM "inventory_lot_balances" b
      JOIN "inventory_levels" lv ON lv."id" = b."inventoryLevelId"
      JOIN "inventory_lots" l ON l."id" = b."lotId"
      JOIN "catalog_variants" v ON v."id" = b."catalogVariantId" AND v."companyId" = b."companyId"
      JOIN "catalog_items" i ON i."id" = v."catalogItemId" AND i."companyId" = v."companyId"
     WHERE b."companyId" = ${companyId} AND lv."locationId" = ${sucursalId} AND b."onHand" > 0
       AND NOT EXISTS (SELECT 1 FROM "inventory_count_lines" cl WHERE cl."sessionId" = ${conteoId} AND cl."catalogVariantId" = b."catalogVariantId" AND cl."lotId" = b."lotId")`
  const [total, filas] = await Promise.all([
    tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS "n" FROM (${base}) t`,
    tx.$queryRaw<Fila[]>`SELECT "varianteId", "loteId", "loteCodigo", "loteVencimiento", "sku", "nombre" FROM (${base}) t ORDER BY "orden1", "orden2", "varianteId", "orden3" LIMIT ${MAX_POR_CONTAR_VISIBLES}`,
  ])
  return { total: total[0]?.n ?? 0, items: filas }
}

export interface FilaHojaDeConteo {
  sku: string
  barcode: string | null
  producto: string
  /** INV-5b3: el lote de la fila (null en un producto sin lotes). */
  lote: string | null
}

/**
 * La HOJA DE CONTEO EN BLANCO de una sucursal: qué tiene existencias, sin decir cuántas (para contar en papel o en Excel y subir el
 * resultado). Es el conteo a ciegas llevado al papel. Un producto con lotes sale en UNA FILA POR LOTE con existencias.
 */
export async function hojaDeConteoEnTx(tx: Tx, companyId: string, sucursalId: string): Promise<{ filas: FilaHojaDeConteo[]; truncado: boolean }> {
  const filas = await tx.$queryRaw<FilaHojaDeConteo[]>`
    SELECT "sku", "barcode", "producto", "lote" FROM (
      SELECT v."sku" AS "sku", v."barcode" AS "barcode",
             CASE WHEN v."isDefault" THEN i."name" ELSE i."name" || ' · ' || v."name" END AS "producto", NULL::text AS "lote",
             i."name" AS "orden1", v."position" AS "orden2", v."id" AS "orden3", ''::text AS "orden4"
        FROM "inventory_levels" lv
        JOIN "catalog_variants" v ON v."id" = lv."catalogVariantId" AND v."companyId" = lv."companyId"
        JOIN "catalog_items" i ON i."id" = v."catalogItemId" AND i."companyId" = v."companyId"
       WHERE lv."companyId" = ${companyId} AND lv."locationId" = ${sucursalId} AND lv."onHand" > 0
         AND NOT EXISTS (SELECT 1 FROM "inventory_lot_tracking" t WHERE t."catalogVariantId" = lv."catalogVariantId")
      UNION ALL
      SELECT v."sku", v."barcode", CASE WHEN v."isDefault" THEN i."name" ELSE i."name" || ' · ' || v."name" END, l."code", i."name", v."position", v."id", l."code"
        FROM "inventory_lot_balances" b
        JOIN "inventory_levels" lv ON lv."id" = b."inventoryLevelId"
        JOIN "inventory_lots" l ON l."id" = b."lotId"
        JOIN "catalog_variants" v ON v."id" = b."catalogVariantId" AND v."companyId" = b."companyId"
        JOIN "catalog_items" i ON i."id" = v."catalogItemId" AND i."companyId" = v."companyId"
       WHERE b."companyId" = ${companyId} AND lv."locationId" = ${sucursalId} AND b."onHand" > 0
    ) t
    ORDER BY "orden1", "orden2", "orden3", "orden4"
    LIMIT ${TOPE_FILAS_HOJA + 1}`
  const truncado = filas.length > TOPE_FILAS_HOJA
  return { filas: (truncado ? filas.slice(0, TOPE_FILAS_HOJA) : filas).map((f) => ({ sku: f.sku, barcode: f.barcode, producto: f.producto, lote: f.lote })), truncado }
}

/**
 * Las existencias de AHORA de lo que tiene un conteo, por línea (`claveDeLinea`: producto, o producto y lote). Sirve para avisar de
 * antemano qué líneas no se podrán aplicar (dejarían menos de lo apartado); aplicar vuelve a comprobarlo bajo candado. Una línea de un
 * lote se compara con el saldo de ESE lote.
 */
export async function saldosActualesDeConteoEnTx(tx: Tx, companyId: string, conteoId: string, sucursalId: string): Promise<Map<string, { onHand: number; reserved: number; damaged: number }>> {
  const productos = await tx.inventoryLevel.findMany({
    where: { companyId, locationId: sucursalId, variant: { countLines: { some: { sessionId: conteoId, lotId: null } } } },
    select: { catalogVariantId: true, onHand: true, reserved: true, damaged: true },
  })
  const lotes = await tx.inventoryLotBalance.findMany({
    where: { companyId, level: { locationId: sucursalId }, lot: { countLines: { some: { sessionId: conteoId } } } },
    select: { catalogVariantId: true, lotId: true, onHand: true, reserved: true, damaged: true },
  })
  return new Map([
    ...productos.map((f) => [claveDeLinea(f.catalogVariantId, null), { onHand: f.onHand, reserved: f.reserved, damaged: f.damaged }] as const),
    ...lotes.map((f) => [claveDeLinea(f.catalogVariantId, f.lotId), { onHand: f.onHand, reserved: f.reserved, damaged: f.damaged }] as const),
  ])
}

export interface LoteParaContar {
  loteId: string
  codigo: string
  /** `YYYY-MM-DD` o null (no vence, o es «SIN LOTE»). */
  vencimiento: string | null
  legado: boolean
  /** Ya tiene línea en este conteo. */
  contado: boolean
}

/**
 * Los lotes entre los que se elige al contar un producto con lotes: los que tienen existencias en cualquier sucursal o ya tuvieron saldo en
 * ESTA, y siempre «SIN LOTE» (por si se encuentra algo sin lote). A CIEGAS: código y vencimiento, nunca cantidades. En orden FEFO.
 */
export async function lotesParaContarEnTx(tx: Tx, companyId: string, conteoId: string, varianteId: string, sucursalId: string): Promise<LoteParaContar[]> {
  const filas = await tx.$queryRaw<{ loteId: string; codigo: string; vencimiento: string | null; legado: boolean; contado: boolean }[]>`
    SELECT l."id" AS "loteId", l."code" AS "codigo", l."expiresOn"::text AS "vencimiento", l."legacy" AS "legado",
           EXISTS (SELECT 1 FROM "inventory_count_lines" cl WHERE cl."sessionId" = ${conteoId} AND cl."lotId" = l."id") AS "contado"
      FROM "inventory_lots" l
     WHERE l."companyId" = ${companyId} AND l."catalogVariantId" = ${varianteId}
       AND (l."legacy"
            OR EXISTS (SELECT 1 FROM "inventory_lot_balances" b WHERE b."lotId" = l."id" AND b."onHand" > 0)
            OR EXISTS (SELECT 1 FROM "inventory_lot_balances" b JOIN "inventory_levels" lv ON lv."id" = b."inventoryLevelId" WHERE b."lotId" = l."id" AND lv."locationId" = ${sucursalId}))
     ORDER BY l."legacy" DESC, (l."expiresOn" IS NULL), l."expiresOn", l."code"
     LIMIT 100`
  return filas
}

// ── INV-2c · Transferencias con envío ────────────────────────────────────────

export const POR_PAGINA_TRASLADOS = 30

export interface FilaTraslado {
  id: string
  numero: string
  estado: EstadoTraslado
  origenId: string
  origenNombre: string
  destinoId: string
  destinoNombre: string
  nota: string | null
  creadoEn: Date
  cerradoEn: Date | null
  enviadoPorNombre: string | null
  lineas: number
  unidades: number
  recibidas: number
  /** Lo que sigue en camino ahora mismo (0 si ya se cerró). */
  enTransito: number
}

export interface TrasladosPagina {
  filas: FilaTraslado[]
  siguiente: string | null
}

const SELECT_TRASLADO = {
  id: true,
  number: true,
  status: true,
  fromLocationId: true,
  toLocationId: true,
  note: true,
  createdAt: true,
  closedAt: true,
  sentById: true,
  lineCount: true,
  unitCount: true,
  fromLocation: { select: { nombre: true } },
  toLocation: { select: { nombre: true } },
  lines: { select: { quantitySent: true, quantityReceived: true, quantityReturned: true, quantityLost: true } },
} satisfies Prisma.InventoryTransferSelect

type TrasladoCrudo = Prisma.InventoryTransferGetPayload<{ select: typeof SELECT_TRASLADO }>

function filaDeTraslado(r: TrasladoCrudo, nombres: Map<string, string>): FilaTraslado {
  const lineas = r.lines.map((l) => ({ enviado: l.quantitySent, recibido: l.quantityReceived, devuelto: l.quantityReturned, perdido: l.quantityLost }))
  return {
    id: r.id,
    numero: r.number,
    estado: r.status,
    origenId: r.fromLocationId,
    origenNombre: r.fromLocation.nombre,
    destinoId: r.toLocationId,
    destinoNombre: r.toLocation.nombre,
    nota: r.note,
    creadoEn: r.createdAt,
    cerradoEn: r.closedAt,
    enviadoPorNombre: r.sentById ? (nombres.get(r.sentById) ?? null) : null,
    lineas: r.lineCount,
    unidades: r.unitCount,
    recibidas: lineas.reduce((s, l) => s + l.recibido, 0),
    enTransito: r.status === 'SENT' || r.status === 'PARTIAL' ? lineas.reduce((s, l) => s + pendienteDeLinea(l), 0) : 0,
  }
}

/**
 * Las transferencias de la empresa, de la más reciente a la más antigua, con los
 * filtros de la pantalla. `abiertas` trae solo las que siguen en camino (enviadas
 * o recibidas en parte). Paginado por cursor (`createdAt|id`).
 */
export async function trasladosDeLaEmpresaEnTx(
  tx: Tx,
  companyId: string,
  f: FiltrosTraslados,
  opciones: { zonaHoraria: string; cursor?: string | null; limite?: number; abiertas?: boolean }
): Promise<TrasladosPagina> {
  const limite = Math.max(1, Math.min(opciones.limite ?? POR_PAGINA_TRASLADOS, 200))
  const antes = leerCursor(opciones.cursor)
  const q = f.q?.trim()
  const fechas = rangoDeFechas(f, opciones.zonaHoraria)
  const filas = await tx.inventoryTransfer.findMany({
    where: {
      companyId,
      ...(f.sucursalId ? { OR: [{ fromLocationId: f.sucursalId }, { toLocationId: f.sucursalId }] } : {}),
      ...(opciones.abiertas ? { status: { in: ['SENT', 'PARTIAL'] as EstadoTraslado[] } } : f.estado ? { status: f.estado } : {}),
      ...(fechas.gte || fechas.lt ? { createdAt: fechas } : {}),
      AND: [
        ...(q ? [{ OR: [{ number: { contains: q, mode: 'insensitive' as const } }, { note: { contains: q, mode: 'insensitive' as const } }] }] : []),
        ...(antes ? [{ OR: [{ createdAt: { lt: antes.creadoEn } }, { createdAt: antes.creadoEn, id: { lt: antes.id } }] }] : []),
      ],
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limite + 1,
    select: SELECT_TRASLADO,
  })
  const hayMas = filas.length > limite
  const pagina = hayMas ? filas.slice(0, limite) : filas
  const nombres = await nombresDeUsuarios(tx, pagina.map((r) => r.sentById))
  const ultimo = pagina[pagina.length - 1]
  return { filas: pagina.map((r) => filaDeTraslado(r, nombres)), siguiente: hayMas && ultimo ? armarCursor(ultimo.createdAt, ultimo.id) : null }
}

export interface LineaDeTrasladoVista {
  varianteId: string
  sku: string
  barcode: string | null
  itemNombre: string
  nombreVariante: string
  esDefault: boolean
  enviado: number
  recibido: number
  devuelto: number
  perdido: number
  /** Lo que sigue en camino de este producto. */
  pendiente: number
}

export interface MovimientoDeTraslado {
  id: string
  tipo: InventoryMovementType
  cantidad: number
  sucursalNombre: string
  producto: string
  sku: string
  creadoEn: Date
  usuarioNombre: string | null
  motivo: string | null
}

export interface DetalleTraslado extends FilaTraslado {
  cerradoPorNombre: string | null
  motivoCierre: string | null
  perdidas: number
  devueltas: number
  detalle: LineaDeTrasladoVista[]
  /** Cada movimiento del ledger que esta transferencia produjo: la salida, cada recepción y, si se canceló, la devolución. */
  historial: MovimientoDeTraslado[]
}

/** Una transferencia con todas sus líneas e historial; null si no existe o es de otra empresa (se ven igual a propósito). */
export async function trasladoDetalleEnTx(tx: Tx, companyId: string, id: string): Promise<DetalleTraslado | null> {
  if (typeof id !== 'string' || id === '' || id.length > 120) return null
  const r = await tx.inventoryTransfer.findFirst({
    where: { id, companyId },
    select: {
      ...SELECT_TRASLADO,
      closedById: true,
      closeReason: true,
      receivedUnits: true,
      returnedUnits: true,
      lostUnits: true,
      lines: {
        orderBy: [{ position: 'asc' }],
        select: {
          catalogVariantId: true,
          quantitySent: true,
          quantityReceived: true,
          quantityReturned: true,
          quantityLost: true,
          variant: { select: { sku: true, barcode: true, name: true, isDefault: true, item: { select: { name: true } } } },
        },
      },
    },
  })
  if (!r) return null
  const movimientos = await tx.inventoryMovement.findMany({
    where: { companyId, referenceType: 'TRANSFER', referenceId: r.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 1000,
    select: {
      id: true,
      type: true,
      quantity: true,
      createdAt: true,
      userId: true,
      reason: true,
      level: { select: { location: { select: { nombre: true } }, variant: { select: { sku: true, name: true, isDefault: true, item: { select: { name: true } } } } } },
    },
  })
  const nombres = await nombresDeUsuarios(tx, [r.sentById, r.closedById, ...movimientos.map((m) => m.userId)])
  const detalle: LineaDeTrasladoVista[] = r.lines.map((l) => ({
    varianteId: l.catalogVariantId,
    sku: l.variant.sku,
    barcode: l.variant.barcode,
    itemNombre: l.variant.item.name,
    nombreVariante: l.variant.name,
    esDefault: l.variant.isDefault,
    enviado: l.quantitySent,
    recibido: l.quantityReceived,
    devuelto: l.quantityReturned,
    perdido: l.quantityLost,
    pendiente: pendienteDeLinea({ enviado: l.quantitySent, recibido: l.quantityReceived, devuelto: l.quantityReturned, perdido: l.quantityLost }),
  }))
  return {
    ...filaDeTraslado(r, nombres),
    cerradoPorNombre: r.closedById ? (nombres.get(r.closedById) ?? null) : null,
    motivoCierre: r.closeReason,
    perdidas: r.lostUnits ?? 0,
    devueltas: r.returnedUnits ?? 0,
    detalle,
    historial: movimientos.map((m) => ({
      id: m.id,
      tipo: m.type,
      cantidad: m.quantity,
      sucursalNombre: m.level.location.nombre,
      producto: m.level.variant.isDefault ? m.level.variant.item.name : `${m.level.variant.item.name} · ${m.level.variant.name}`,
      sku: m.level.variant.sku,
      creadoEn: m.createdAt,
      usuarioNombre: m.userId ? (nombres.get(m.userId) ?? null) : null,
      motivo: m.reason,
    })),
  }
}

export interface EnTransitoDeVariante {
  total: number
  traslados: Array<{ id: string; numero: string; origenNombre: string; destinoNombre: string; pendiente: number }>
}

/**
 * Lo que de UNA variante va EN CAMINO entre sucursales ahora mismo: salió del origen
 * y todavía no llegó. No está disponible en ninguna sucursal; esto es lo único que lo
 * enseña. Se lee en su propia transacción desde la ficha para que, si la migración
 * aún no se aplicó, la ficha siga funcionando sin esta tarjeta.
 */
export async function enTransitoDeVarianteEnTx(tx: Tx, companyId: string, varianteId: string): Promise<EnTransitoDeVariante> {
  const lineas = await tx.inventoryTransferLine.findMany({
    where: { companyId, catalogVariantId: varianteId, transfer: { status: { in: ['SENT', 'PARTIAL'] } } },
    orderBy: [{ transfer: { createdAt: 'asc' } }],
    take: 200,
    select: {
      quantitySent: true,
      quantityReceived: true,
      quantityReturned: true,
      quantityLost: true,
      transfer: { select: { id: true, number: true, fromLocation: { select: { nombre: true } }, toLocation: { select: { nombre: true } } } },
    },
  })
  const traslados = lineas
    .map((l) => ({
      id: l.transfer.id,
      numero: l.transfer.number,
      origenNombre: l.transfer.fromLocation.nombre,
      destinoNombre: l.transfer.toLocation.nombre,
      pendiente: pendienteDeLinea({ enviado: l.quantitySent, recibido: l.quantityReceived, devuelto: l.quantityReturned, perdido: l.quantityLost }),
    }))
    .filter((t) => t.pendiente > 0)
  return { total: traslados.reduce((s, t) => s + t.pendiente, 0), traslados }
}
