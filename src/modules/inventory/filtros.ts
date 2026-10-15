import type { InventoryMovementType } from '@prisma/client'
import { esEstadoOrden, type EstadoOrden } from './compras'
import { TIPOS_DE_MOVIMIENTO } from './domain'
import type { FiltrosReposicion } from './reposicion'
import { PAGINA_MAXIMA_REPORTES, esEstadoCobertura, periodoValido, PERIODO_POR_DEFECTO, type FiltrosKardex, type FiltrosRotacion, type FiltrosSinVentas } from './reportes'
import { FILTRO_SIN_MOTIVO, type FiltrosMermas } from './mermas'
import { esMotivoDelCatalogo } from './motivos'
import { ORDEN_MARGEN_POR_DEFECTO, esOrdenMargen, type FiltrosMargen } from './margen'
import { VENTANA_POR_DEFECTO, esClaseVencimiento, ventanaValida, type FiltrosVencimientos } from './vencimientos'

/**
 * COMMERCE CORE · inventario — los filtros de la pantalla de movimientos y de su
 * exportación.
 *
 * PURO y sin servidor: la página, la ruta de exportación y las pruebas leen la
 * misma URL con la MISMA función, de modo que el CSV contiene exactamente las
 * filas que la persona tenía filtradas en pantalla (el fallo clásico de una
 * exportación es que "exporta otra cosa").
 *
 * Todo lo que llega por la URL es texto libre: aquí se valida la FORMA (un tipo
 * que existe, una fecha real, un texto acotado). Que una sucursal o un usuario
 * pertenezcan a la empresa NO se decide aquí: las lecturas filtran siempre por
 * `companyId`, así que un id ajeno simplemente no encuentra nada.
 */

export type ParametrosUrl = Record<string, string | string[] | undefined>

/** «Movimientos sin persona detrás»: ventas, reservas, vencimientos. */
export const USUARIO_SISTEMA = 'SISTEMA'

export const LARGO_MAXIMO_BUSQUEDA = 80
const LARGO_MAXIMO_ID = 80

export interface FiltrosMovimientos {
  tipo?: InventoryMovementType
  sucursalId?: string
  /** `USUARIO_SISTEMA` o el id de un usuario. */
  usuario?: string
  /** `YYYY-MM-DD` en la zona horaria de la empresa, ambos extremos incluidos. */
  desde?: string
  hasta?: string
  /** Nombre, SKU o código de barras. */
  q?: string
}

export interface PeticionMovimientos {
  filtros: FiltrosMovimientos
  /** Cursor de la página siguiente (`ISO|id`), o null para empezar por lo más reciente. */
  cursor: string | null
}

function primero(v: string | string[] | undefined): string | undefined {
  const x = Array.isArray(v) ? v[0] : v
  return typeof x === 'string' ? x : undefined
}

/** Una fecha `YYYY-MM-DD` que existe en el calendario, o undefined. */
export function fechaValida(v: string | undefined): string | undefined {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined
  const t = Date.parse(`${v}T00:00:00Z`)
  if (Number.isNaN(t)) return undefined
  // Rechaza el 31 de febrero: `Date.parse` lo desborda al mes siguiente.
  return new Date(t).toISOString().slice(0, 10) === v ? v : undefined
}

/** Un identificador cualquiera de la URL: no vacío, acotado, sin espacios. */
function idValido(v: string | undefined): string | undefined {
  if (!v) return undefined
  const t = v.trim()
  return t !== '' && t.length <= LARGO_MAXIMO_ID && !/\s/.test(t) ? t : undefined
}

export function armarCursor(creadoEn: Date, id: string): string {
  return `${creadoEn.toISOString()}|${id}`
}

export function leerCursor(c: string | null | undefined): { creadoEn: Date; id: string } | null {
  if (!c) return null
  const corte = c.indexOf('|')
  if (corte < 0) return null
  const fecha = new Date(c.slice(0, corte))
  const id = c.slice(corte + 1)
  if (Number.isNaN(fecha.getTime()) || id === '' || id.length > LARGO_MAXIMO_ID) return null
  return { creadoEn: fecha, id }
}

export function leerFiltrosMovimientos(sp: ParametrosUrl): PeticionMovimientos {
  const tipoCrudo = primero(sp.tipo)
  const tipo = (TIPOS_DE_MOVIMIENTO as readonly string[]).includes(tipoCrudo ?? '') ? (tipoCrudo as InventoryMovementType) : undefined
  let desde = fechaValida(primero(sp.desde))
  let hasta = fechaValida(primero(sp.hasta))
  // Un rango al revés no es un error que enseñarle a nadie: se lee en el orden correcto.
  if (desde && hasta && desde > hasta) [desde, hasta] = [hasta, desde]
  const q = primero(sp.q)?.trim().slice(0, LARGO_MAXIMO_BUSQUEDA)
  const cursorCrudo = primero(sp.cursor)
  const sucursalId = idValido(primero(sp.sucursal))
  const usuario = idValido(primero(sp.usuario))
  return {
    filtros: {
      ...(tipo ? { tipo } : {}),
      ...(sucursalId ? { sucursalId } : {}),
      ...(usuario ? { usuario } : {}),
      ...(desde ? { desde } : {}),
      ...(hasta ? { hasta } : {}),
      ...(q ? { q } : {}),
    },
    cursor: leerCursor(cursorCrudo) ? (cursorCrudo as string) : null,
  }
}

/** La cadena de consulta (sin `?`) que reproduce estos filtros; vacía si no hay ninguno. */
export function consultaDeFiltros(f: FiltrosMovimientos, cursor?: string | null): string {
  const p = new URLSearchParams()
  if (f.tipo) p.set('tipo', f.tipo)
  if (f.sucursalId) p.set('sucursal', f.sucursalId)
  if (f.usuario) p.set('usuario', f.usuario)
  if (f.desde) p.set('desde', f.desde)
  if (f.hasta) p.set('hasta', f.hasta)
  if (f.q) p.set('q', f.q)
  if (cursor) p.set('cursor', cursor)
  return p.toString()
}

/** Cuántos filtros hay puestos (el cursor no cuenta: es la página, no un filtro). */
export function cuantosFiltros(f: FiltrosMovimientos): number {
  return Object.values(f).filter((v) => v !== undefined && v !== '').length
}

/**
 * ¿El texto buscado ES, exactamente, el SKU o el código de barras de este
 * producto? Es lo que hace un lector de código de barras: escribe el código y
 * pulsa Enter. Si coincide exacto, la pantalla salta a la ficha en vez de
 * enseñar una lista de un solo renglón.
 */
export function esCodigoExacto(q: string | undefined, v: { sku: string; barcode: string | null }): boolean {
  const n = q?.trim().toLowerCase()
  if (!n) return false
  return v.sku.toLowerCase() === n || (v.barcode !== null && v.barcode.toLowerCase() === n)
}

// ── INV-2a · lista de entradas de mercancía ──────────────────────────────────

export interface FiltrosEntradas {
  sucursalId?: string
  /** `YYYY-MM-DD` en la zona horaria de la empresa, ambos extremos incluidos. */
  desde?: string
  hasta?: string
  /** Número de la entrada (`ENT-2026-000012`) o texto de su referencia (la factura). */
  q?: string
}

export interface PeticionEntradas {
  filtros: FiltrosEntradas
  cursor: string | null
}

/** Lee la URL de la lista de entradas con las mismas reglas que la de movimientos. */
export function leerFiltrosEntradas(sp: ParametrosUrl): PeticionEntradas {
  const { filtros, cursor } = leerFiltrosMovimientos(sp)
  return {
    filtros: {
      ...(filtros.sucursalId ? { sucursalId: filtros.sucursalId } : {}),
      ...(filtros.desde ? { desde: filtros.desde } : {}),
      ...(filtros.hasta ? { hasta: filtros.hasta } : {}),
      ...(filtros.q ? { q: filtros.q } : {}),
    },
    cursor,
  }
}

export function consultaDeFiltrosEntradas(f: FiltrosEntradas, cursor?: string | null): string {
  return consultaDeFiltros({ sucursalId: f.sucursalId, desde: f.desde, hasta: f.hasta, q: f.q }, cursor)
}

// ── INV-2b · Conteos físicos ─────────────────────────────────────────────────

export interface FiltrosConteos {
  sucursalId?: string
  estado?: 'OPEN' | 'APPLIED' | 'CANCELLED'
  /** `YYYY-MM-DD` en la zona horaria de la empresa, ambos extremos incluidos (fecha de apertura). */
  desde?: string
  hasta?: string
  /** Número del conteo (`CNT-2026-000003`) o texto de su nota. */
  q?: string
}

export interface PeticionConteos {
  filtros: FiltrosConteos
  cursor: string | null
}

/** Lee la URL de la lista de conteos con las mismas reglas que la de movimientos y entradas. */
export function leerFiltrosConteos(sp: ParametrosUrl): PeticionConteos {
  const { filtros, cursor } = leerFiltrosMovimientos(sp)
  const estado = primero(sp.estado)
  return {
    filtros: {
      ...(filtros.sucursalId ? { sucursalId: filtros.sucursalId } : {}),
      ...(estado === 'OPEN' || estado === 'APPLIED' || estado === 'CANCELLED' ? { estado } : {}),
      ...(filtros.desde ? { desde: filtros.desde } : {}),
      ...(filtros.hasta ? { hasta: filtros.hasta } : {}),
      ...(filtros.q ? { q: filtros.q } : {}),
    },
    cursor,
  }
}

export function consultaDeFiltrosConteos(f: FiltrosConteos, cursor?: string | null): string {
  const p = new URLSearchParams(consultaDeFiltros({ sucursalId: f.sucursalId, desde: f.desde, hasta: f.hasta, q: f.q }, cursor))
  if (f.estado) p.set('estado', f.estado)
  return p.toString()
}

// ── INV-2c · Transferencias con envío ────────────────────────────────────────

export interface FiltrosTraslados {
  /** La sucursal de cualquiera de los dos extremos: la que envía o la que recibe. */
  sucursalId?: string
  estado?: 'SENT' | 'PARTIAL' | 'RECEIVED' | 'CANCELLED'
  /** `YYYY-MM-DD` en la zona horaria de la empresa, ambos extremos incluidos (fecha de envío). */
  desde?: string
  hasta?: string
  /** Número de la transferencia (`TRF-2026-000003`) o texto de su nota. */
  q?: string
}

export interface PeticionTraslados {
  filtros: FiltrosTraslados
  cursor: string | null
}

/** Lee la URL de la lista de transferencias con las mismas reglas que movimientos, entradas y conteos. */
export function leerFiltrosTraslados(sp: ParametrosUrl): PeticionTraslados {
  const { filtros, cursor } = leerFiltrosMovimientos(sp)
  const estado = primero(sp.estado)
  return {
    filtros: {
      ...(filtros.sucursalId ? { sucursalId: filtros.sucursalId } : {}),
      ...(estado === 'SENT' || estado === 'PARTIAL' || estado === 'RECEIVED' || estado === 'CANCELLED' ? { estado } : {}),
      ...(filtros.desde ? { desde: filtros.desde } : {}),
      ...(filtros.hasta ? { hasta: filtros.hasta } : {}),
      ...(filtros.q ? { q: filtros.q } : {}),
    },
    cursor,
  }
}

export function consultaDeFiltrosTraslados(f: FiltrosTraslados, cursor?: string | null): string {
  const p = new URLSearchParams(consultaDeFiltros({ sucursalId: f.sucursalId, desde: f.desde, hasta: f.hasta, q: f.q }, cursor))
  if (f.estado) p.set('estado', f.estado)
  return p.toString()
}

// ── INV-3b · Compras ─────────────────────────────────────────────────────────

export interface FiltrosOrdenes {
  proveedorId?: string
  /** La sucursal que recibe la mercancía. */
  sucursalId?: string
  estado?: EstadoOrden
  /** `YYYY-MM-DD` en la zona horaria de la empresa, ambos extremos incluidos (fecha de creación). */
  desde?: string
  hasta?: string
  /** Número de la orden (`OC-2026-000003`), su referencia, su nota o el nombre del proveedor. */
  q?: string
}

export interface PeticionOrdenes {
  filtros: FiltrosOrdenes
  cursor: string | null
}

/** Lee la URL de la lista de órdenes de compra con las mismas reglas que movimientos, entradas y transferencias. */
export function leerFiltrosOrdenes(sp: ParametrosUrl): PeticionOrdenes {
  const { filtros, cursor } = leerFiltrosMovimientos(sp)
  const estado = primero(sp.estado)
  const proveedorId = idValido(primero(sp.proveedor))
  return {
    filtros: {
      ...(proveedorId ? { proveedorId } : {}),
      ...(filtros.sucursalId ? { sucursalId: filtros.sucursalId } : {}),
      ...(esEstadoOrden(estado) ? { estado } : {}),
      ...(filtros.desde ? { desde: filtros.desde } : {}),
      ...(filtros.hasta ? { hasta: filtros.hasta } : {}),
      ...(filtros.q ? { q: filtros.q } : {}),
    },
    cursor,
  }
}

export function consultaDeFiltrosOrdenes(f: FiltrosOrdenes, cursor?: string | null): string {
  const p = new URLSearchParams(consultaDeFiltros({ sucursalId: f.sucursalId, desde: f.desde, hasta: f.hasta, q: f.q }, cursor))
  if (f.estado) p.set('estado', f.estado)
  if (f.proveedorId) p.set('proveedor', f.proveedorId)
  return p.toString()
}

// ── INV-3a · Valor del inventario ────────────────────────────────────────────

export const FILAS_POR_PAGINA_VALOR = 50
export const PAGINA_MAXIMA_VALOR = 2000

export interface FiltrosValor {
  /** Solo las existencias de esta sucursal (si falta, todas). */
  sucursalId?: string
  /** Nombre, SKU o código de barras del producto. */
  q?: string
  /** Solo los productos en existencia que no tienen costo. */
  sinCosto?: boolean
  /** `YYYY-MM`, el mes del costo de ventas (si falta, el mes en curso de la empresa). */
  mes?: string
  /** Página de la tabla, desde 1. */
  pagina: number
}

/** Un mes `YYYY-MM` que existe en el calendario, o undefined. */
export function mesValido(v: string | undefined): string | undefined {
  if (!v || !/^\d{4}-\d{2}$/.test(v)) return undefined
  const mes = Number(v.slice(5))
  const anio = Number(v.slice(0, 4))
  return mes >= 1 && mes <= 12 && anio >= 2000 && anio <= 2100 ? v : undefined
}

/** Lee la URL de «Valor del inventario» con las mismas reglas de sucursal y texto que las demás listas. */
export function leerFiltrosValor(sp: ParametrosUrl): FiltrosValor {
  const { filtros } = leerFiltrosMovimientos(sp)
  const mes = mesValido(primero(sp.mes))
  const n = Number(primero(sp.pagina))
  return {
    ...(filtros.sucursalId ? { sucursalId: filtros.sucursalId } : {}),
    ...(filtros.q ? { q: filtros.q } : {}),
    ...(primero(sp.sinCosto) === '1' ? { sinCosto: true } : {}),
    ...(mes ? { mes } : {}),
    pagina: Number.isInteger(n) && n >= 1 && n <= PAGINA_MAXIMA_VALOR ? n : 1,
  }
}

/** La consulta de la URL para estos filtros (y, si se pide, otra página). Sin la página 1: es la de por defecto. */
export function consultaDeFiltrosValor(f: FiltrosValor, pagina: number = f.pagina): string {
  const p = new URLSearchParams()
  if (f.sucursalId) p.set('sucursal', f.sucursalId)
  if (f.q) p.set('q', f.q)
  if (f.sinCosto) p.set('sinCosto', '1')
  if (f.mes) p.set('mes', f.mes)
  if (pagina > 1) p.set('pagina', String(pagina))
  return p.toString()
}

// ── INV-3c · Reposición ──────────────────────────────────────────────────────

/**
 * Los filtros de la pantalla de Reposición (y de su archivo) desde la URL. Todo lo que llega es texto libre: una sucursal o un
 * proveedor solo filtran si la página comprueba que son de la empresa; `sin` pide lo que no tiene proveedor.
 */
export function leerFiltrosReposicion(sp: ParametrosUrl): FiltrosReposicion {
  const sucursalId = idValido(primero(sp.sucursal))
  const proveedorId = idValido(primero(sp.proveedor)) // `sin` pasa como un id más: la consulta lo entiende
  const q = primero(sp.q)?.trim().slice(0, 80)
  return { ...(sucursalId ? { sucursalId } : {}), ...(proveedorId ? { proveedorId } : {}), ...(q ? { q } : {}) }
}

export function consultaDeFiltrosReposicion(f: FiltrosReposicion): string {
  const p = new URLSearchParams()
  if (f.sucursalId) p.set('sucursal', f.sucursalId)
  if (f.proveedorId) p.set('proveedor', f.proveedorId)
  if (f.q) p.set('q', f.q)
  return p.toString()
}

// ── INV-4a · Informes de existencias ─────────────────────────────────────────

function paginaDeInforme(v: string | undefined): number {
  const n = Number(v)
  return Number.isInteger(n) && n >= 1 && n <= PAGINA_MAXIMA_REPORTES ? n : 1
}

/**
 * La URL del kardex: el producto, la sucursal, el rango de días (locales) y, mientras no hay producto, el texto con que se busca.
 * Las fechas y el texto se leen igual que en Movimientos (un rango al revés se endereza).
 */
export function leerFiltrosKardex(sp: ParametrosUrl): FiltrosKardex {
  const { filtros } = leerFiltrosMovimientos(sp)
  const varianteId = idValido(primero(sp.variante))
  return {
    ...(varianteId ? { varianteId } : {}),
    ...(filtros.sucursalId ? { sucursalId: filtros.sucursalId } : {}),
    ...(filtros.desde ? { desde: filtros.desde } : {}),
    ...(filtros.hasta ? { hasta: filtros.hasta } : {}),
    ...(filtros.q ? { q: filtros.q } : {}),
  }
}

export function consultaDeFiltrosKardex(f: FiltrosKardex): string {
  const p = new URLSearchParams()
  if (f.varianteId) p.set('variante', f.varianteId)
  if (f.sucursalId) p.set('sucursal', f.sucursalId)
  if (f.desde) p.set('desde', f.desde)
  if (f.hasta) p.set('hasta', f.hasta)
  if (f.q) p.set('q', f.q)
  return p.toString()
}

/** La URL de «stock sin ventas»: los días (solo los periodos que hay), la sucursal, el texto y la página. */
export function leerFiltrosSinVentas(sp: ParametrosUrl): FiltrosSinVentas {
  const { filtros } = leerFiltrosMovimientos(sp)
  return {
    dias: periodoValido(primero(sp.dias)),
    ...(filtros.sucursalId ? { sucursalId: filtros.sucursalId } : {}),
    ...(filtros.q ? { q: filtros.q } : {}),
    pagina: paginaDeInforme(primero(sp.pagina)),
  }
}

/** La consulta de la URL (y, si se pide, otra página). Sin lo que es el valor de siempre: 90 días y la página 1. */
export function consultaDeFiltrosSinVentas(f: FiltrosSinVentas, pagina: number = f.pagina): string {
  const p = new URLSearchParams()
  if (f.dias !== PERIODO_POR_DEFECTO) p.set('dias', String(f.dias))
  if (f.sucursalId) p.set('sucursal', f.sucursalId)
  if (f.q) p.set('q', f.q)
  if (pagina > 1) p.set('pagina', String(pagina))
  return p.toString()
}

/** La URL de «vence pronto»: la ventana en días (solo las que hay), el estado, la sucursal, el texto y la página. */
export function leerFiltrosVencimientos(sp: ParametrosUrl): FiltrosVencimientos {
  const { filtros } = leerFiltrosMovimientos(sp)
  const clase = primero(sp.estado)
  return {
    dias: ventanaValida(primero(sp.dias)),
    ...(esClaseVencimiento(clase) ? { clase } : {}),
    ...(filtros.sucursalId ? { sucursalId: filtros.sucursalId } : {}),
    ...(filtros.q ? { q: filtros.q } : {}),
    pagina: paginaDeInforme(primero(sp.pagina)),
  }
}

/** La consulta de la URL (y, si se pide, otra página). Sin lo que es el valor de siempre: 30 días y la página 1. */
export function consultaDeFiltrosVencimientos(f: FiltrosVencimientos, pagina: number = f.pagina): string {
  const p = new URLSearchParams()
  if (f.dias !== VENTANA_POR_DEFECTO) p.set('dias', String(f.dias))
  if (f.clase) p.set('estado', f.clase)
  if (f.sucursalId) p.set('sucursal', f.sucursalId)
  if (f.q) p.set('q', f.q)
  if (pagina > 1) p.set('pagina', String(pagina))
  return p.toString()
}

/** La URL de «rotación y cobertura»: los días, la sucursal, el texto, el estado de cobertura y la página. */
export function leerFiltrosRotacion(sp: ParametrosUrl): FiltrosRotacion {
  const { filtros } = leerFiltrosMovimientos(sp)
  const estado = primero(sp.estado)
  return {
    dias: periodoValido(primero(sp.dias)),
    ...(filtros.sucursalId ? { sucursalId: filtros.sucursalId } : {}),
    ...(filtros.q ? { q: filtros.q } : {}),
    ...(esEstadoCobertura(estado) ? { estado } : {}),
    pagina: paginaDeInforme(primero(sp.pagina)),
  }
}

export function consultaDeFiltrosRotacion(f: FiltrosRotacion, pagina: number = f.pagina): string {
  const p = new URLSearchParams()
  if (f.dias !== PERIODO_POR_DEFECTO) p.set('dias', String(f.dias))
  if (f.sucursalId) p.set('sucursal', f.sucursalId)
  if (f.q) p.set('q', f.q)
  if (f.estado) p.set('estado', f.estado)
  if (pagina > 1) p.set('pagina', String(pagina))
  return p.toString()
}

/**
 * INV-4b · La URL de «mermas por motivo»: el rango de días (locales), la sucursal, el motivo (un código del catálogo o `sin`), el
 * texto del producto y la página. Un motivo que el catálogo no conoce se ignora (no filtra nada), igual que una sucursal ajena.
 */
export function leerFiltrosMermas(sp: ParametrosUrl): FiltrosMermas {
  const { filtros } = leerFiltrosMovimientos(sp)
  const motivo = primero(sp.motivo)
  return {
    ...(filtros.desde ? { desde: filtros.desde } : {}),
    ...(filtros.hasta ? { hasta: filtros.hasta } : {}),
    ...(filtros.sucursalId ? { sucursalId: filtros.sucursalId } : {}),
    ...(motivo === FILTRO_SIN_MOTIVO || esMotivoDelCatalogo(motivo) ? { motivo } : {}),
    ...(filtros.q ? { q: filtros.q } : {}),
    pagina: paginaDeInforme(primero(sp.pagina)),
  }
}

export function consultaDeFiltrosMermas(f: FiltrosMermas, pagina: number = f.pagina): string {
  const p = new URLSearchParams()
  if (f.desde) p.set('desde', f.desde)
  if (f.hasta) p.set('hasta', f.hasta)
  if (f.sucursalId) p.set('sucursal', f.sucursalId)
  if (f.motivo) p.set('motivo', f.motivo)
  if (f.q) p.set('q', f.q)
  if (pagina > 1) p.set('pagina', String(pagina))
  return p.toString()
}

/**
 * INV-4c · La URL del «margen real»: el rango de días (locales), la sucursal, el texto del producto, el orden y la página. Un orden
 * que no existe cae al de siempre; una sucursal ajena no filtra (lo decide la pantalla contra las de la empresa).
 */
export function leerFiltrosMargen(sp: ParametrosUrl): FiltrosMargen {
  const { filtros } = leerFiltrosMovimientos(sp)
  const orden = primero(sp.orden)
  return {
    ...(filtros.desde ? { desde: filtros.desde } : {}),
    ...(filtros.hasta ? { hasta: filtros.hasta } : {}),
    ...(filtros.sucursalId ? { sucursalId: filtros.sucursalId } : {}),
    ...(filtros.q ? { q: filtros.q } : {}),
    orden: esOrdenMargen(orden) ? orden : ORDEN_MARGEN_POR_DEFECTO,
    pagina: paginaDeInforme(primero(sp.pagina)),
  }
}

export function consultaDeFiltrosMargen(f: FiltrosMargen, pagina: number = f.pagina): string {
  const p = new URLSearchParams()
  if (f.desde) p.set('desde', f.desde)
  if (f.hasta) p.set('hasta', f.hasta)
  if (f.sucursalId) p.set('sucursal', f.sucursalId)
  if (f.q) p.set('q', f.q)
  if (f.orden !== ORDEN_MARGEN_POR_DEFECTO) p.set('orden', f.orden)
  if (pagina > 1) p.set('pagina', String(pagina))
  return p.toString()
}
