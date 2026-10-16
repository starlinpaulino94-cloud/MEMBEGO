import { CANTIDAD_MAXIMA, EXISTENCIA_MAXIMA, aplicarMovimiento, cubetasDeSaldo, disponible, type Movimiento, type Saldo } from './domain'
import { CODIGO_SIN_LOTE, esCodigoSinLote } from './lotes'

/**
 * COMMERCE CORE · inventario — conteo físico por sucursal (INV-2b). PURO: sin
 * base de datos ni servidor, para que lo use el navegador y lo pruebe cualquiera.
 *
 * El modelo en una frase: se cuenta lo que hay (vendible + apartado; lo dañado no
 * se cuenta), el sistema recuerda lo que decía en el momento de contar, y al
 * aplicar se ajusta por la DIFERENCIA — no por el número — para que las ventas
 * ocurridas mientras se contaba no se pierdan. Lo que no se contó no se toca.
 *
 * INV-5b3 · Un producto que LLEVA LOTES se cuenta POR LOTE: su línea es «producto + lote», con lo contado de ese lote y lo que el
 * sistema decía de ese lote al contar. Todo lo de arriba vale igual, con el saldo del lote en el lugar del saldo del producto.
 */

/** Prefijo del correlativo: `CNT-2026-000001`. */
export const PREFIJO_CONTEO = 'CNT'
/** Productos por conteo (medido contra los 45 s de una transacción, como las importaciones). Para seguir, se aplica y se abre otro. */
export const MAX_LINEAS_CONTEO = 1000
export const MAX_NOTA_CONTEO = 500
export const MAX_MOTIVO_CANCELACION = 300
/** Filas de la hoja de conteo en blanco (el CSV que se descarga para contar en papel o en Excel). */
export const TOPE_FILAS_HOJA = 5000
/** Cuántos «por contar» se enseñan en pantalla (el total siempre se dice). */
export const MAX_POR_CONTAR_VISIBLES = 200

export type EstadoConteo = 'OPEN' | 'APPLIED' | 'CANCELLED'

export const ETIQUETA_ESTADO_CONTEO: Record<EstadoConteo, string> = {
  OPEN: 'Abierto',
  APPLIED: 'Aplicado',
  CANCELLED: 'Cancelado',
}

export function esEstadoConteo(v: unknown): v is EstadoConteo {
  return v === 'OPEN' || v === 'APPLIED' || v === 'CANCELLED'
}

/** Cómo se captura: `SUMAR` es lo que hace un lector (un escaneo = una unidad más); `FIJAR` es escribir el número. */
export type ModoConteo = 'SUMAR' | 'FIJAR'

export function esModoConteo(v: unknown): v is ModoConteo {
  return v === 'SUMAR' || v === 'FIJAR'
}

/**
 * La cantidad que la persona escribió. `FIJAR` admite 0 («lo busqué y no hay»);
 * `SUMAR` no (sumar nada no es un escaneo). Un entero, de 0 a un millón.
 */
export function validarCantidadContada(n: unknown, modo: ModoConteo): { ok: true; valor: number } | { ok: false; error: string } {
  if (typeof n !== 'number' || !Number.isInteger(n)) return { ok: false, error: 'La cantidad contada debe ser un número entero.' }
  const minimo = modo === 'SUMAR' ? 1 : 0
  if (n < minimo) return { ok: false, error: modo === 'SUMAR' ? 'Suma al menos una unidad.' : 'La cantidad contada no puede ser negativa.' }
  if (n > CANTIDAD_MAXIMA) return { ok: false, error: `Un conteo no puede pasar de ${CANTIDAD_MAXIMA.toLocaleString('es-DO')} unidades por producto.` }
  return { ok: true, valor: n }
}

// ── Diferencia y clasificación ───────────────────────────────────────────────

export type ResultadoLinea = 'COINCIDE' | 'SOBRANTE' | 'FALTANTE'

/** Contado menos lo que decía el sistema al contar: positivo = sobra, negativo = falta. */
export function diferenciaDeConteo(contado: number, esperado: number): number {
  return contado - esperado
}

export function clasificarDiferencia(delta: number): ResultadoLinea {
  if (delta === 0) return 'COINCIDE'
  return delta > 0 ? 'SOBRANTE' : 'FALTANTE'
}

export const ETIQUETA_RESULTADO: Record<ResultadoLinea, string> = {
  COINCIDE: 'Coincide',
  SOBRANTE: 'Sobrante',
  FALTANTE: 'Faltante',
}

export interface ResumenVarianza {
  lineas: number
  coinciden: number
  sobrantes: number
  faltantes: number
  unidadesSobrantes: number
  unidadesFaltantes: number
  /** Sobrantes menos faltantes, en unidades. */
  neto: number
}

export function resumirVarianza(lineas: ReadonlyArray<{ contado: number; esperado: number }>): ResumenVarianza {
  const r: ResumenVarianza = { lineas: lineas.length, coinciden: 0, sobrantes: 0, faltantes: 0, unidadesSobrantes: 0, unidadesFaltantes: 0, neto: 0 }
  for (const l of lineas) {
    const d = diferenciaDeConteo(l.contado, l.esperado)
    if (d === 0) r.coinciden++
    else if (d > 0) {
      r.sobrantes++
      r.unidadesSobrantes += d
    } else {
      r.faltantes++
      r.unidadesFaltantes += -d
    }
  }
  r.neto = r.unidadesSobrantes - r.unidadesFaltantes
  return r
}

/** Lo que más descuadra, primero (por unidades, sin importar el signo); a igualdad, por nombre y, dentro de un producto, por lote. */
export function ordenarPorDiferencia<T extends { contado: number; esperado: number; nombre: string; lote?: string | null }>(lineas: readonly T[]): T[] {
  return [...lineas].sort((a, b) => {
    const da = Math.abs(diferenciaDeConteo(a.contado, a.esperado))
    const db = Math.abs(diferenciaDeConteo(b.contado, b.esperado))
    return db - da || a.nombre.localeCompare(b.nombre, 'es') || (a.lote ?? '').localeCompare(b.lote ?? '', 'es')
  })
}

// ── INV-5b3 · Contar por lote ────────────────────────────────────────────────

/** Lo que identifica una línea de conteo: el producto y, si lleva lotes, el lote. Sirve de llave en mapas, listas y filas de pantalla. */
export function claveDeLinea(varianteId: string, loteId: string | null | undefined): string {
  return `${varianteId}|${loteId ?? ''}`
}

/** «SIN LOTE» o «Lote A-1»: cómo se nombra un lote en una línea de conteo. */
export function nombreDeLote(codigo: string): string {
  return esCodigoSinLote(codigo) ? CODIGO_SIN_LOTE : `Lote ${codigo}`
}

/** «Lote A-1 · vence 2027-09-01», «Lote A-1 · no vence» o «SIN LOTE» (el lote de lo que ya había no lleva fecha). */
export function etiquetaDeLote(codigo: string, vencimiento: string | null): string {
  if (esCodigoSinLote(codigo)) return CODIGO_SIN_LOTE
  return `${nombreDeLote(codigo)} · ${vencimiento ? `vence ${vencimiento}` : 'no vence'}`
}

/** El nombre de una línea para un mensaje: el producto y, si lo hay, su lote («Crema · lote A-1»). */
export function nombreDeLinea(producto: string, loteCodigo: string | null | undefined): string {
  return loteCodigo ? `${producto} · ${esCodigoSinLote(loteCodigo) ? CODIGO_SIN_LOTE : `lote ${loteCodigo}`}` : producto
}

/**
 * El orden en que se aplican las líneas de UN producto con lotes: primero lo que SOBRA (suben) y después lo que FALTA (bajan); a igual
 * signo, por código de lote. Es solo determinista: la suma de los ajustes es la misma en cualquier orden.
 */
export function compararParaAplicar(a: { delta: number; loteCodigo: string | null }, b: { delta: number; loteCodigo: string | null }): number {
  const sa = a.delta > 0 ? 0 : 1
  const sb = b.delta > 0 ? 0 : 1
  return sa - sb || (a.loteCodigo ?? '').localeCompare(b.loteCodigo ?? '', 'es')
}

/**
 * Reparte movimientos en RONDAS de modo que un mismo saldo de sucursal aparezca UNA sola vez por ronda: la escritura por lote de
 * movimientos (`escribirMovimientosPorLote`) exige que el «antes» de cada saldo sea el real, y dos ajustes del mismo producto (uno por
 * lote) se aplican uno tras otro. La k-ésima aparición de un saldo va a la ronda k; se conserva el orden.
 */
export function repartirEnRondas<T extends { nivelId: string }>(items: readonly T[]): T[][] {
  const rondas: T[][] = []
  const vistas = new Map<string, number>()
  for (const item of items) {
    const k = vistas.get(item.nivelId) ?? 0
    vistas.set(item.nivelId, k + 1)
    ;(rondas[k] ??= []).push(item)
  }
  return rondas
}

// ── El ajuste de una línea ───────────────────────────────────────────────────

export type PlanDeAjuste =
  | { tipo: 'NADA' }
  | { tipo: 'AJUSTE'; movimiento: Movimiento }
  | { tipo: 'RECHAZADA'; motivo: string }

/**
 * Qué hay que hacer con UNA línea al aplicar. `delta` es contado − esperado al
 * contar; `actual` es el saldo REAL de este momento (puede haber cambiado desde
 * que se contó: se le aplica la diferencia, no el número). Se prueba con el
 * ledger puro, así que el invariante «lo vendible nunca queda en negativo» y el
 * tope de existencia salen del mismo código que en todas partes: un faltante que
 * dejaría la existencia por debajo de lo apartado se RECHAZA, no se aplica.
 */
export function planDeAjuste(delta: number, actual: Saldo, motivo: string): PlanDeAjuste {
  if (delta === 0) return { tipo: 'NADA' }
  const sube = delta > 0
  const cantidad = Math.abs(delta)
  if (cantidad > CANTIDAD_MAXIMA) {
    return { tipo: 'RECHAZADA', motivo: `La diferencia (${cantidad.toLocaleString('es-DO')}) pasa del máximo por ajuste (${CANTIDAD_MAXIMA.toLocaleString('es-DO')}). Revisa el conteo de este producto.` }
  }
  const movimiento: Movimiento = { type: 'ADJUSTMENT', sourceBucket: sube ? null : 'AVAILABLE', destinationBucket: sube ? 'AVAILABLE' : null, quantity: cantidad, reason: motivo }
  try {
    aplicarMovimiento(cubetasDeSaldo(actual), movimiento)
  } catch {
    if (sube) return { tipo: 'RECHAZADA', motivo: `La existencia superaría el máximo admitido (${EXISTENCIA_MAXIMA.toLocaleString('es-DO')}). Revisa el conteo de este producto.` }
    const apartadas = actual.reserved > 0 ? ` y ${actual.reserved} están apartadas` : ''
    return {
      tipo: 'RECHAZADA',
      motivo: `Quitar ${cantidad.toLocaleString('es-DO')} dejaría menos de lo apartado: hoy hay ${actual.onHand.toLocaleString('es-DO')}${apartadas} (vendible: ${disponible(actual).toLocaleString('es-DO')}). Libera o cobra las reservas, o corrige el conteo de este producto.`,
    }
  }
  return { tipo: 'AJUSTE', movimiento }
}

/** El motivo que llevan los ajustes de un conteo: el número del conteo, para rastrearlo desde el historial. */
export function motivoDeConteo(numero: string): string {
  return `Conteo físico ${numero}`
}
