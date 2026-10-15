import { CANTIDAD_MAXIMA } from './domain'
import { valorDe, formatearMonto, type Costo } from './costos'
import { MAX_LINEAS_ORDEN } from './compras'

/**
 * COMMERCE CORE · inventario — INV-3c: reposición («qué comprar»). PURO: sin base de
 * datos ni servidor, para que lo usen el navegador, el servicio y las pruebas.
 *
 * El modelo en una frase: cada producto, en cada sucursal, puede tener un UMBRAL
 * (el aviso de stock bajo que ya existía) y un «LLENAR HASTA» (hasta cuánto se quiere
 * tener). La POSICIÓN de un producto en una sucursal es lo que hay disponible MÁS lo
 * que ya está pedido a proveedores y todavía no llegó MÁS lo que va en camino desde
 * otra sucursal: lo que ya viene no se vuelve a pedir. Cuando la posición baja al
 * umbral (o, sin umbral, queda por debajo del objetivo) se sugiere pedir lo que falta
 * para llegar al objetivo. Las sugerencias se agrupan por proveedor y sucursal, porque
 * una orden de compra tiene UN proveedor y recibe en UNA sucursal.
 *
 * Una sugerencia es una propuesta, no una orden: crear el borrador no pide nada, y el
 * borrador se edita como cualquier otro.
 */

/** Lo que dice el borrador que se crea desde la pantalla (queda como nota de la orden). */
export const NOTA_BORRADOR_REPOSICION = 'Borrador creado desde Reposición.'

/** Tope de saldos con objetivo que se leen de una vez (las pantallas avisan si se corta). */
export const MAX_NIVELES_REPOSICION = 5000

/** Lo que se puede filtrar en la pantalla de Reposición y en su archivo. */
export interface FiltrosReposicion {
  /** Solo los saldos de esta sucursal. */
  sucursalId?: string
  /** Solo lo que se le pide a este proveedor; `'sin'` = lo que no tiene proveedor al que pedirlo. */
  proveedorId?: string
  /** Nombre, SKU o código de barras del producto. */
  q?: string
}

// ── Validación de «llenar hasta» ─────────────────────────────────────────────

/** «Llenar hasta»: entero de 0 a CANTIDAD_MAXIMA (0 = sin objetivo). */
export function validarObjetivo(n: unknown): { ok: true; valor: number } | { ok: false; error: string } {
  if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n)) return { ok: false, error: '«Llenar hasta» debe ser un número entero.' }
  if (n < 0) return { ok: false, error: '«Llenar hasta» no puede ser negativo.' }
  if (n > CANTIDAD_MAXIMA) return { ok: false, error: `«Llenar hasta» no puede pasar de ${CANTIDAD_MAXIMA.toLocaleString('es-DO')}.` }
  return { ok: true, valor: n }
}

/**
 * El objetivo tiene que quedar POR ENCIMA del umbral de aviso: si el umbral fuera igual o mayor, «pedir hasta llegar al
 * objetivo» no pediría nada. Si falta cualquiera de los dos (0), no hay nada que comparar. Devuelve el mensaje, o null si
 * está bien. `sucursal` aclara dónde ocurre cuando una operación toca varias sucursales a la vez.
 */
export function errorObjetivoContraUmbral(e: { umbral: number; llenarHasta: number; sucursal?: string }): string | null {
  if (e.umbral <= 0 || e.llenarHasta <= 0) return null
  if (e.llenarHasta > e.umbral) return null
  const donde = e.sucursal ? ` en ${e.sucursal}` : ''
  return `«Llenar hasta» (${e.llenarHasta})${donde} tiene que ser mayor que el umbral de aviso (${e.umbral}). Si solo quieres el aviso, deja «llenar hasta» en 0.`
}

// ── Posición y sugerencia ────────────────────────────────────────────────────

export interface PosicionDeStock {
  /** Lo vendible ahora: existencias − apartado. */
  disponible: number
  /** Pedido a proveedores y todavía no recibido (órdenes pedidas o recibidas en parte), para ESTA sucursal. */
  pedido: number
  /** Enviado desde otra sucursal y todavía en camino hacia ESTA. */
  enCamino: number
}

/** Lo que hay + lo que ya viene. */
export function posicionDeStock(p: PosicionDeStock): number {
  return p.disponible + p.pedido + p.enCamino
}

export type EstadoReposicion = 'SIN_OBJETIVO' | 'AL_DIA' | 'REPONER'

export interface ConfigReposicion {
  /** Avisar (y reponer) cuando la posición baje a este número. 0 = sin umbral. */
  umbral: number
  /** Llenar hasta. 0 = sin objetivo. */
  llenarHasta: number
}

/**
 * ¿Hay que reponer, y cuánto? Sin objetivo no hay propuesta. Con umbral, se repone cuando la posición BAJA AL UMBRAL (igual
 * o menos, como la alerta de stock bajo); sin umbral, en cuanto queda por debajo del objetivo. Lo que se sugiere es
 * exactamente lo que falta para llegar al objetivo.
 */
export function sugerenciaDeReposicion(cfg: ConfigReposicion, posicion: number): { estado: EstadoReposicion; sugerida: number } {
  if (cfg.llenarHasta <= 0) return { estado: 'SIN_OBJETIVO', sugerida: 0 }
  const toca = cfg.umbral > 0 ? posicion <= cfg.umbral : posicion < cfg.llenarHasta
  const falta = cfg.llenarHasta - posicion
  if (!toca || falta <= 0) return { estado: 'AL_DIA', sugerida: 0 }
  return { estado: 'REPONER', sugerida: falta }
}

// ── Proveedor de cada línea ──────────────────────────────────────────────────

export interface VinculoReposicion {
  proveedorId: string
  proveedorNombre: string
  activo: boolean
  preferido: boolean
  /** El último costo con que ese proveedor surtió el producto, si lo hay. */
  ultimoCosto: Costo | null
}

/**
 * A qué proveedor se le pide un producto: al preferido, si está activo; si no hay preferido activo pero el producto solo
 * tiene UN proveedor activo, a ese; en cualquier otro caso a ninguno (la pantalla lo dice y manda a la ficha del producto
 * a vincular uno: elegir entre varios es una decisión de compra, no de la máquina). Un proveedor desactivado nunca se elige.
 */
export function elegirProveedor(vinculos: readonly VinculoReposicion[]): VinculoReposicion | null {
  const activos = vinculos.filter((v) => v.activo)
  const preferidos = activos.filter((v) => v.preferido)
  if (preferidos.length > 0) return [...preferidos].sort(porNombreYId)[0]
  if (activos.length === 1) return activos[0]
  return null
}

function porNombreYId(a: { proveedorNombre: string; proveedorId: string }, b: { proveedorNombre: string; proveedorId: string }): number {
  return a.proveedorNombre.localeCompare(b.proveedorNombre, 'es', { sensitivity: 'base' }) || (a.proveedorId < b.proveedorId ? -1 : a.proveedorId > b.proveedorId ? 1 : 0)
}

// ── Armar la pantalla ────────────────────────────────────────────────────────

/** Un saldo con objetivo, tal como sale de la base. */
export interface NivelParaReposicion {
  nivelId: string
  varianteId: string
  sucursalId: string
  sucursalNombre: string
  sku: string
  barcode: string | null
  producto: string
  nombreVariante: string
  esDefault: boolean
  onHand: number
  reserved: number
  umbral: number
  llenarHasta: number
}

/** La clave con que se cruzan las cantidades por producto y sucursal. */
export function claveDeNivel(varianteId: string, sucursalId: string): string {
  return `${varianteId}|${sucursalId}`
}

export interface LineaDeReposicion {
  varianteId: string
  sucursalId: string
  sku: string
  barcode: string | null
  producto: string
  nombreVariante: string
  esDefault: boolean
  disponible: number
  pedido: number
  enCamino: number
  /** Ya en un borrador de orden (no cuenta como pedido: un borrador no es un compromiso). */
  enBorrador: number
  umbral: number
  llenarHasta: number
  sugerida: number
  /** El último costo de su proveedor para este producto; null si no se sabe. */
  ultimoCosto: Costo | null
}

export interface BorradorExistente {
  id: string
  numero: string
}

export interface GrupoDeReposicion {
  /** Estable entre cargas: `proveedor:sucursal` (o `sin:sucursal`). */
  clave: string
  proveedor: { id: string; nombre: string } | null
  sucursalId: string
  sucursalNombre: string
  lineas: LineaDeReposicion[]
  unidades: number
  /** Lo que cuesta lo sugerido, con dos decimales, contando solo las líneas con costo conocido. */
  valor: string
  /** Líneas sin costo conocido (no suman al valor). */
  lineasSinCosto: number
  /** Borradores de este proveedor para esta sucursal que ya existen (para no duplicar a ciegas). */
  borradores: BorradorExistente[]
  /** Más líneas de las que admite una orden: hay que partirla. */
  excedeLaOrden: boolean
}

export interface EntradaReposicion {
  niveles: readonly NivelParaReposicion[]
  /** Por `claveDeNivel`: lo pedido a proveedores y aún no recibido. */
  pedido: ReadonlyMap<string, number>
  /** Por `claveDeNivel`: lo que va en camino desde otras sucursales. */
  enCamino: ReadonlyMap<string, number>
  /** Por `claveDeNivel`: lo que ya está en borradores de orden. */
  enBorrador: ReadonlyMap<string, number>
  /** Por producto: sus proveedores. */
  vinculos: ReadonlyMap<string, readonly VinculoReposicion[]>
  /** Por `proveedorId|sucursalId`: los borradores que ya hay. */
  borradores: ReadonlyMap<string, readonly BorradorExistente[]>
}

export interface ResultadoReposicion {
  grupos: GrupoDeReposicion[]
  /** Saldos con objetivo que NO hace falta reponer. */
  alDia: number
  /** Saldos con objetivo en total (los que se reponen más los que están al día). */
  conObjetivo: number
}

export function claveDeBorradores(proveedorId: string, sucursalId: string): string {
  return `${proveedorId}|${sucursalId}`
}

const vacio = <T,>(): readonly T[] => []

/**
 * Convierte los saldos con objetivo en la propuesta: solo los que hay que reponer, cada uno con su cantidad, su proveedor y
 * su costo, agrupados por proveedor y sucursal. Los grupos salen por proveedor (los que no tienen, al final) y sucursal; las
 * líneas por producto: el mismo orden en cada carga.
 */
export function armarReposicion(e: EntradaReposicion): ResultadoReposicion {
  const porGrupo = new Map<string, GrupoDeReposicion>()
  let alDia = 0
  for (const n of e.niveles) {
    const k = claveDeNivel(n.varianteId, n.sucursalId)
    const pedido = e.pedido.get(k) ?? 0
    const enCamino = e.enCamino.get(k) ?? 0
    const disponibleAhora = n.onHand - n.reserved
    const s = sugerenciaDeReposicion({ umbral: n.umbral, llenarHasta: n.llenarHasta }, posicionDeStock({ disponible: disponibleAhora, pedido, enCamino }))
    if (s.estado !== 'REPONER') {
      if (s.estado === 'AL_DIA') alDia++
      continue
    }
    const elegido = elegirProveedor(e.vinculos.get(n.varianteId) ?? vacio())
    const proveedor = elegido ? { id: elegido.proveedorId, nombre: elegido.proveedorNombre } : null
    const claveGrupo = `${proveedor?.id ?? 'sin'}:${n.sucursalId}`
    let g = porGrupo.get(claveGrupo)
    if (!g) {
      g = {
        clave: claveGrupo,
        proveedor,
        sucursalId: n.sucursalId,
        sucursalNombre: n.sucursalNombre,
        lineas: [],
        unidades: 0,
        valor: formatearMonto(BigInt(0)),
        lineasSinCosto: 0,
        borradores: proveedor ? [...(e.borradores.get(claveDeBorradores(proveedor.id, n.sucursalId)) ?? vacio())] : [],
        excedeLaOrden: false,
      }
      porGrupo.set(claveGrupo, g)
    }
    g.lineas.push({
      varianteId: n.varianteId,
      sucursalId: n.sucursalId,
      sku: n.sku,
      barcode: n.barcode,
      producto: n.producto,
      nombreVariante: n.nombreVariante,
      esDefault: n.esDefault,
      disponible: disponibleAhora,
      pedido,
      enCamino,
      enBorrador: e.enBorrador.get(k) ?? 0,
      umbral: n.umbral,
      llenarHasta: n.llenarHasta,
      sugerida: s.sugerida,
      ultimoCosto: elegido?.ultimoCosto ?? null,
    })
  }
  const grupos = [...porGrupo.values()]
  for (const g of grupos) {
    g.lineas.sort(porProducto)
    g.unidades = g.lineas.reduce((t, l) => t + l.sugerida, 0)
    g.lineasSinCosto = g.lineas.filter((l) => l.ultimoCosto === null).length
    g.valor = formatearMonto(valorDeGrupo(g))
    g.excedeLaOrden = g.lineas.length > MAX_LINEAS_ORDEN
  }
  grupos.sort(porProveedorYSucursal)
  const repuestos = grupos.reduce((t, g) => t + g.lineas.length, 0)
  return { grupos, alDia, conObjetivo: repuestos + alDia }
}

function porProducto(a: LineaDeReposicion, b: LineaDeReposicion): number {
  return (
    a.producto.localeCompare(b.producto, 'es', { sensitivity: 'base' }) ||
    a.nombreVariante.localeCompare(b.nombreVariante, 'es', { sensitivity: 'base' }) ||
    (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0) ||
    (a.varianteId < b.varianteId ? -1 : a.varianteId > b.varianteId ? 1 : 0)
  )
}

function porProveedorYSucursal(a: GrupoDeReposicion, b: GrupoDeReposicion): number {
  if (a.proveedor && !b.proveedor) return -1
  if (!a.proveedor && b.proveedor) return 1
  if (a.proveedor && b.proveedor) {
    const p = porNombreYId({ proveedorNombre: a.proveedor.nombre, proveedorId: a.proveedor.id }, { proveedorNombre: b.proveedor.nombre, proveedorId: b.proveedor.id })
    if (p !== 0) return p
  }
  return a.sucursalNombre.localeCompare(b.sucursalNombre, 'es', { sensitivity: 'base' }) || (a.sucursalId < b.sucursalId ? -1 : a.sucursalId > b.sucursalId ? 1 : 0)
}

// ── Resumen ──────────────────────────────────────────────────────────────────

export interface ResumenReposicion {
  grupos: number
  /** Productos por sucursal que hay que reponer. */
  productos: number
  unidades: number
  /** Lo que cuesta lo sugerido para los que tienen proveedor y costo, con dos decimales. */
  valor: string
  /** Productos por reponer sin proveedor al que pedirlos. */
  sinProveedor: number
  /** Productos por reponer sin costo conocido (no suman al valor). */
  sinCosto: number
}

export function resumirReposicion(grupos: readonly GrupoDeReposicion[]): ResumenReposicion {
  let productos = 0
  let unidades = 0
  let sinProveedor = 0
  let sinCosto = 0
  let valor = BigInt(0)
  for (const g of grupos) {
    productos += g.lineas.length
    unidades += g.unidades
    sinCosto += g.lineasSinCosto
    if (!g.proveedor) sinProveedor += g.lineas.length
    valor += valorDeGrupo(g)
  }
  return { grupos: grupos.length, productos, unidades, valor: formatearMonto(valor), sinProveedor, sinCosto }
}

/** Lo que cuesta lo sugerido en un grupo, en diezmilésimas, contando solo las líneas con costo conocido. */
export function valorDeGrupo(g: GrupoDeReposicion): Costo {
  return g.lineas.reduce((t, l) => (l.ultimoCosto === null ? t : t + valorDe(l.sugerida, l.ultimoCosto)), BigInt(0))
}
