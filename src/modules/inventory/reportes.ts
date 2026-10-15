import { valorDe, type Costo } from './costos'

/**
 * COMMERCE CORE · inventario — INV-4a: informes de existencias (kardex, stock sin
 * ventas, rotación y cobertura). PURO: sin base de datos ni servidor, para que lo
 * usen el servicio de lecturas, las pantallas y las pruebas.
 *
 * LA EXISTENCIA QUE SE SIGUE. El kardex sigue la existencia FÍSICA: vendible +
 * apartado + dañado. Es lo que la empresa tiene y todavía no ha dado de baja. Un
 * movimiento la cambia solo si entra desde fuera (una entrada, una devolución, la
 * pata de llegada de una transferencia) o sale del inventario (una venta, la pata de
 * salida, una baja); pasar de una cubeta a otra (apartar, dañar, recuperar) no la
 * cambia. Con eso, el saldo de cada fila sale de sumar, hacia atrás desde lo que hay
 * hoy: nada se guarda aparte que pueda desactualizarse.
 *
 * LOS COSTOS. Una entrada vale lo que costó (null si no se capturó) y una salida el
 * costo promedio de ese instante (null si el producto no tenía), tal como los congeló
 * INV-3a. No hay un saldo valorizado histórico: el promedio solo se guarda vigente, y
 * lo que se enseña son las entradas y las salidas valoradas, con lo que no tiene costo
 * contado aparte, nunca como cero.
 */

export type Cubeta = 'AVAILABLE' | 'RESERVED' | 'DAMAGED'

export const ETIQUETA_CUBETA: Record<Cubeta, string> = {
  AVAILABLE: 'vendible',
  RESERVED: 'apartado',
  DAMAGED: 'dañado',
}

export type SentidoKardex = 'ENTRA' | 'SALE' | 'INTERNO'

/** Hacia dónde mueve la existencia física un movimiento: entra, sale, o solo cambia de cubeta. */
export function sentidoDeMovimiento(m: { origen: Cubeta | null; destino: Cubeta | null }): SentidoKardex {
  if (m.origen === null && m.destino !== null) return 'ENTRA'
  if (m.origen !== null && m.destino === null) return 'SALE'
  return 'INTERNO'
}

/** Cuánto cambia la existencia física: + lo que entra, − lo que sale, 0 si solo cambia de cubeta. */
export function efectoFisico(m: { cantidad: number; origen: Cubeta | null; destino: Cubeta | null }): number {
  const s = sentidoDeMovimiento(m)
  return s === 'ENTRA' ? m.cantidad : s === 'SALE' ? -m.cantidad : 0
}

/** «de vendible a dañado», o null si el movimiento no cambia de cubeta. */
export function describirCambioDeCubeta(m: { origen: Cubeta | null; destino: Cubeta | null }): string | null {
  if (m.origen === null || m.destino === null) return null
  return `de ${ETIQUETA_CUBETA[m.origen]} a ${ETIQUETA_CUBETA[m.destino]}`
}

// ── Filtros de los informes ──────────────────────────────────────────────────

/** El kardex es de UN producto; sin él, la pantalla busca (con `q`) y deja elegir. Las fechas son días LOCALES de la empresa. */
export interface FiltrosKardex {
  varianteId?: string
  sucursalId?: string
  desde?: string
  hasta?: string
  /** Para buscar el producto cuando todavía no hay uno elegido. */
  q?: string
}

export const FILAS_POR_PAGINA_REPORTES = 50
export const PAGINA_MAXIMA_REPORTES = 2000

export interface FiltrosSinVentas {
  /** Cuántos días sin una venta. */
  dias: number
  sucursalId?: string
  q?: string
  pagina: number
}

export interface FiltrosRotacion {
  dias: number
  sucursalId?: string
  q?: string
  estado?: EstadoCobertura
  pagina: number
}

// ── Kardex ───────────────────────────────────────────────────────────────────

export interface MovimientoParaKardex {
  id: string
  creadoEn: Date
  sucursalId: string
  sucursalNombre: string
  tipo: string
  cantidad: number
  origen: Cubeta | null
  destino: Cubeta | null
  motivo: string | null
  referenciaTipo: string | null
  referenciaId: string | null
  usuarioNombre: string | null
  /** El costo con que se valoró; null = sin costo (o el que lee no puede verlo). */
  costo: Costo | null
}

export interface FilaKardex extends MovimientoParaKardex {
  sentido: SentidoKardex
  entra: number
  sale: number
  /** La existencia física justo después de este movimiento. */
  saldo: number
  /** cantidad × costo de lo que entra o sale; null si no tiene costo, si no cambia la existencia o si no se pueden ver costos. */
  valor: Costo | null
}

export interface TotalesKardex {
  entradas: number
  salidas: number
  /** Lo que costó lo que entró (solo lo que tenía costo). */
  valorEntradas: Costo
  /** Lo que costó lo que salió (solo lo que tenía costo). */
  valorSalidas: Costo
  /** Unidades que entraron sin costo conocido. */
  entradasSinCosto: number
  /** Unidades que salieron sin costo conocido. */
  salidasSinCosto: number
}

const CERO: Costo = BigInt(0)

/**
 * El kardex de una lista de movimientos YA ordenada del más antiguo al más reciente: cada fila con lo que entra o sale, el saldo
 * físico que deja y su valor, y los totales del periodo. `apertura` es la existencia física justo antes del primer movimiento.
 * Sin `conCostos` ninguna fila ni total lleva costo ni cuenta «sin costo» (quien no ve costos tampoco se entera de cuáles faltan).
 */
export function armarKardex(apertura: number, movimientos: readonly MovimientoParaKardex[], conCostos: boolean): { filas: FilaKardex[]; totales: TotalesKardex; saldoFinal: number } {
  const totales: TotalesKardex = { entradas: 0, salidas: 0, valorEntradas: CERO, valorSalidas: CERO, entradasSinCosto: 0, salidasSinCosto: 0 }
  let saldo = apertura
  const filas: FilaKardex[] = movimientos.map((m) => {
    const sentido = sentidoDeMovimiento(m)
    const entra = sentido === 'ENTRA' ? m.cantidad : 0
    const sale = sentido === 'SALE' ? m.cantidad : 0
    saldo += entra - sale
    const costo = conCostos ? m.costo : null
    const valor = sentido !== 'INTERNO' && costo !== null ? valorDe(m.cantidad, costo) : null
    totales.entradas += entra
    totales.salidas += sale
    if (valor !== null) {
      if (sentido === 'ENTRA') totales.valorEntradas += valor
      else totales.valorSalidas += valor
    } else if (conCostos) {
      if (sentido === 'ENTRA') totales.entradasSinCosto += entra
      if (sentido === 'SALE') totales.salidasSinCosto += sale
    }
    return { ...m, costo, sentido, entra, sale, saldo, valor }
  })
  return { filas, totales, saldoFinal: saldo }
}

// ── Periodos ─────────────────────────────────────────────────────────────────

/** Los periodos que se pueden elegir en días, para «sin ventas» y para «rotación». */
export const PERIODOS_DIAS = [30, 60, 90, 180, 365] as const
export const PERIODO_POR_DEFECTO = 90

/** El periodo pedido si es uno de los que hay; si no, el de siempre. */
export function periodoValido(v: unknown): number {
  const n = typeof v === 'string' ? Number(v.trim()) : typeof v === 'number' ? v : Number.NaN
  return (PERIODOS_DIAS as readonly number[]).includes(n) ? n : PERIODO_POR_DEFECTO
}

const MS_DIA = 86_400_000

/** El instante desde el que se cuenta un periodo de `dias` días que termina en `ahora`. */
export function corteDeDias(ahora: Date, dias: number): Date {
  return new Date(ahora.getTime() - dias * MS_DIA)
}

/** Días completos desde una fecha; null si no hay fecha (nunca ocurrió). */
export function diasDesde(fecha: Date | null, ahora: Date): number | null {
  if (!fecha) return null
  return Math.max(0, Math.floor((ahora.getTime() - fecha.getTime()) / MS_DIA))
}

/** «Nunca», «hoy», «hace 1 día», «hace 40 días». */
export function textoHace(dias: number | null): string {
  if (dias === null) return 'Nunca'
  if (dias === 0) return 'Hoy'
  return dias === 1 ? 'Hace 1 día' : `Hace ${dias} días`
}

// ── Rotación y cobertura ─────────────────────────────────────────────────────

/** Con esta cobertura (o menos) el producto se agota pronto. */
export const DIAS_POCA_COBERTURA = 14
/** Con más cobertura que ésta hay exceso: más de medio año de ventas en el estante. */
export const DIAS_EXCESO_COBERTURA = 180

export type EstadoCobertura = 'AGOTADO' | 'POCA' | 'NORMAL' | 'EXCESO' | 'SIN_VENTAS'

export const ETIQUETA_ESTADO_COBERTURA: Record<EstadoCobertura, string> = {
  AGOTADO: 'Agotado con ventas',
  POCA: 'Se agota pronto',
  NORMAL: 'Normal',
  EXCESO: 'Exceso',
  SIN_VENTAS: 'Sin ventas',
}

export const ESTADOS_COBERTURA = Object.keys(ETIQUETA_ESTADO_COBERTURA) as EstadoCobertura[]

export function esEstadoCobertura(v: unknown): v is EstadoCobertura {
  return typeof v === 'string' && (ESTADOS_COBERTURA as string[]).includes(v)
}

export interface EntradaRotacion {
  /** Vendidas menos devueltas en el periodo. Si salió negativo (más devoluciones que ventas) se toma como cero. */
  vendidas: number
  /** Vendible + apartado al empezar el periodo y hoy. */
  existenciaInicial: number
  existenciaFinal: number
  /** Lo que se puede vender hoy: vendible sin lo apartado. */
  disponible: number
  /** Días del periodo. */
  dias: number
}

export interface Rotacion {
  vendidas: number
  ventaDiaria: number
  /** El promedio entre lo que había al empezar y lo que hay hoy: una aproximación, no un promedio día a día. */
  existenciaPromedio: number
  /** Cuántas veces se vendió la existencia promedio en el periodo; null si no hubo existencia promedio. */
  veces: number | null
  /** Cuántos días dura lo que hay al ritmo del periodo; null si no hubo ventas. */
  coberturaDias: number | null
  estado: EstadoCobertura
}

/**
 * La rotación y la cobertura de un producto. Sin ventas no hay ritmo: no se inventa una cobertura infinita, se dice «sin ventas».
 * Agotado con ventas es lo más urgente; «se agota pronto» y «exceso» se miden contra `DIAS_POCA_COBERTURA` y `DIAS_EXCESO_COBERTURA`.
 */
export function calcularRotacion(e: EntradaRotacion): Rotacion {
  const vendidas = Math.max(0, e.vendidas)
  const inicial = Math.max(0, e.existenciaInicial)
  const final = Math.max(0, e.existenciaFinal)
  const disponible = Math.max(0, e.disponible)
  const existenciaPromedio = (inicial + final) / 2
  const ventaDiaria = vendidas / e.dias
  const veces = existenciaPromedio > 0 ? vendidas / existenciaPromedio : null
  const coberturaDias = ventaDiaria > 0 ? disponible / ventaDiaria : null
  let estado: EstadoCobertura
  if (vendidas === 0) estado = 'SIN_VENTAS'
  else if (disponible === 0) estado = 'AGOTADO'
  else if (coberturaDias !== null && coberturaDias <= DIAS_POCA_COBERTURA) estado = 'POCA'
  else if (coberturaDias !== null && coberturaDias > DIAS_EXCESO_COBERTURA) estado = 'EXCESO'
  else estado = 'NORMAL'
  return { vendidas, ventaDiaria, existenciaPromedio, veces, coberturaDias, estado }
}

/** Orden de la tabla de cobertura: lo más urgente primero (agotado, poca cobertura…), el exceso y lo que no vende al final. */
export function compararCobertura(a: Rotacion, b: Rotacion): number {
  const ca = a.coberturaDias
  const cb = b.coberturaDias
  if (ca === null && cb === null) return 0
  if (ca === null) return 1
  if (cb === null) return -1
  return ca - cb
}

/**
 * Cuántos días de venta cubre el inventario: su valor entre lo que cuesta vender un día. Entero, redondeado a la mitad hacia
 * arriba; null si en el periodo no hubo costo de ventas (no hay ritmo con que medirlo).
 */
export function diasDeInventario(valorInventario: Costo, costoDeVentas: Costo, dias: number): number | null {
  if (costoDeVentas <= CERO) return null
  const dos = BigInt(2)
  return Number((valorInventario * BigInt(dias) * dos + costoDeVentas) / (costoDeVentas * dos))
}
