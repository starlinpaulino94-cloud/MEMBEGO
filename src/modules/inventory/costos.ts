/**
 * COMMERCE CORE · inventario — INV-3a: costo y valor del inventario. PURO: sin
 * base de datos ni servidor, para que lo usen el servicio (que lo vuelve a
 * aplicar, porque no confía en lo que manda el navegador), las pantallas y las
 * pruebas.
 *
 * LOS MONTOS SON ENTEROS. Un costo se guarda con CUATRO decimales (`DECIMAL(14,4)`)
 * y aquí viaja como un `bigint` en diezmilésimas: 12,50 es `125000n`. Con
 * decimales flotantes, `0,1 + 0,2` no es `0,3`, y un promedio ponderado de miles
 * de entradas arrastraría ese error. Con enteros el resultado es exacto y se
 * redondea UNA vez, hacia arriba en la mitad.
 *
 * EL MODELO, en tres frases:
 *   · Cada producto tiene UN costo promedio ponderado para toda la empresa. Una
 *     entrada CON costo lo mueve; una entrada sin costo no lo toca.
 *   · Las salidas (venta, daño, ajuste) y las devoluciones se valoran con el
 *     promedio de ese instante y lo congelan en el movimiento.
 *   · Mientras un producto no tiene promedio, vale el costo de referencia que
 *     se escribió en su ficha del catálogo (si lo tiene); si no, no tiene costo
 *     —y se dice, no se cuenta como cero—.
 */

/** Un costo o un valor, en diezmilésimas de la moneda de la empresa. */
export type Costo = bigint

export const DECIMALES_COSTO = 4
export const FACTOR_COSTO: Costo = BigInt(10000)
/** El costo unitario máximo, en unidades de la moneda (cien millones). Lo repite un CHECK de la base. */
export const COSTO_MAXIMO_UNIDADES = 100_000_000
export const COSTO_MAXIMO: Costo = BigInt(COSTO_MAXIMO_UNIDADES) * FACTOR_COSTO
export const MAX_MOTIVO_COSTO = 300

export type ResultadoCosto = { ok: true; valor: Costo } | { ok: false; error: string }
export type ResultadoCostoOpcional = { ok: true; valor: Costo | null } | { ok: false; error: string }

const FORMA_COSTO = /^\d{1,9}(\.\d{1,4})?$/

/**
 * Un costo escrito por una persona (o por un archivo): dígitos, un punto
 * decimal opcional y hasta cuatro decimales. Sin signos, sin símbolo de
 * moneda y SIN comas: «1,250» es ambiguo (¿mil doscientos cincuenta o uno con
 * veinticinco?) y adivinar es como se estropea un inventario.
 */
export function parsearCosto(v: unknown): ResultadoCosto {
  let t: string
  if (typeof v === 'string') t = v.trim()
  else if (typeof v === 'number' && Number.isFinite(v)) t = String(v)
  else return { ok: false, error: 'El costo no es válido.' }
  if (t === '') return { ok: false, error: 'Escribe el costo.' }
  if (t.includes(',')) return { ok: false, error: `El costo «${t.slice(0, 20)}» lleva una coma. Usa punto para los decimales y no pongas separador de miles (ej: 1250.50).` }
  if (!FORMA_COSTO.test(t)) return { ok: false, error: `El costo «${t.slice(0, 20)}» no es válido: usa solo números, con punto decimal y hasta cuatro decimales (ej: 12.50).` }
  const [entero, decimales = ''] = t.split('.')
  const valor = BigInt(entero) * FACTOR_COSTO + BigInt(decimales.padEnd(DECIMALES_COSTO, '0'))
  if (valor > COSTO_MAXIMO) return { ok: false, error: `El costo no puede pasar de ${COSTO_MAXIMO_UNIDADES.toLocaleString('es-DO')}.` }
  return { ok: true, valor }
}

/** Un costo que puede faltar: `undefined`, `null` o vacío = «no se capturó» (no es un error y no es cero). */
export function costoOpcional(v: unknown): ResultadoCostoOpcional {
  if (v === undefined || v === null) return { ok: true, valor: null }
  if (typeof v === 'string' && v.trim() === '') return { ok: true, valor: null }
  const r = parsearCosto(v)
  return r.ok ? { ok: true, valor: r.valor } : r
}

/** El texto con que viaja un costo a la base: siempre cuatro decimales (`12.5000`). */
export function costoADecimal(c: Costo): string {
  const entero = c / FACTOR_COSTO
  const dec = (c % FACTOR_COSTO).toString().padStart(DECIMALES_COSTO, '0')
  return `${entero}.${dec}`
}

/** Un `DECIMAL` de la base (el `Decimal` de Prisma, un texto o un número) a diezmilésimas. */
export function costoDeDecimal(d: { toFixed(digitos: number): string } | string | number): Costo {
  const t = typeof d === 'string' ? d : typeof d === 'number' ? d.toFixed(DECIMALES_COSTO) : d.toFixed(DECIMALES_COSTO)
  const m = /^(\d+)(?:\.(\d+))?$/.exec(t.trim())
  if (!m) throw new Error(`Costo ilegible: «${t}».`)
  return BigInt(m[1]) * FACTOR_COSTO + BigInt((m[2] ?? '').slice(0, DECIMALES_COSTO).padEnd(DECIMALES_COSTO, '0'))
}

/** División entera redondeando la mitad hacia arriba (todo es no negativo aquí). */
function dividirRedondeando(numerador: bigint, denominador: bigint): bigint {
  return (numerador + denominador / BigInt(2)) / denominador
}

/**
 * El monto para mostrar: dos decimales por defecto (redondeo de la mitad hacia
 * arriba), con separador de miles. `12.5` → «12.50». Con `decimales: 4` enseña el
 * costo tal cual se guarda.
 */
export function formatearMonto(c: Costo, decimales: 2 | 4 = 2): string {
  const paso = decimales === 2 ? BigInt(100) : BigInt(1)
  const redondeado = dividirRedondeando(c, paso) // en centésimas (o diezmilésimas)
  const escala = decimales === 2 ? BigInt(100) : FACTOR_COSTO
  const entero = redondeado / escala
  const dec = (redondeado % escala).toString().padStart(decimales, '0')
  return `${entero.toLocaleString('es-DO')}.${dec}`
}

/**
 * Un COSTO UNITARIO para mostrar: dos decimales, o más solo si hacen falta
 * (0,0525 no se enseña como 0,05). Sin ceros de relleno más allá del segundo.
 */
export function formatearCosto(c: Costo): string {
  const t = formatearMonto(c, 4)
  const [entero, dec] = t.split('.')
  const recortado = dec.replace(/0+$/, '').padEnd(2, '0')
  return `${entero}.${recortado}`
}

/** El valor de `unidades` unidades a un costo: exacto, en diezmilésimas. */
export function valorDe(unidades: number, costo: Costo): Costo {
  return BigInt(unidades) * costo
}

/** El costo con que vale hoy un producto: su promedio, o el de referencia del catálogo; null = no tiene costo. */
export function costoEfectivo(promedio: Costo | null, referencia: Costo | null): Costo | null {
  return promedio ?? referencia
}

export interface ExistenciaPrevia {
  /** Unidades que la empresa tiene del producto ANTES de la entrada (vendible + apartado + dañado, todas las sucursales). */
  unidades: number
  /** El promedio guardado; null si el producto aún no tiene (o su renglón se acaba de crear). */
  promedio: Costo | null
  /** El `cost` de referencia de su ficha del catálogo. */
  referencia: Costo | null
}

/**
 * El nuevo costo promedio tras una entrada CON costo.
 *
 *   · Sin existencias previas → vale el costo de la entrada (lo viejo no pesa).
 *   · Con existencias y un costo previo (el promedio, o el de referencia si aún
 *     no hay promedio) → promedio ponderado por unidades.
 *   · Con existencias y NINGÚN costo previo → no hay con qué ponderar: vale el
 *     costo de la entrada. (Las unidades viejas no se cuentan como cero; se
 *     valoran a este costo, que es lo mejor que se sabe.)
 *
 * Redondea la mitad hacia arriba a la cuarta decimal.
 */
export function promedioPonderado(previa: ExistenciaPrevia, entrada: { unidades: number; costo: Costo }): Costo {
  if (!Number.isInteger(entrada.unidades) || entrada.unidades < 1) throw new Error('La entrada debe traer al menos una unidad.')
  if (!Number.isInteger(previa.unidades) || previa.unidades < 0) throw new Error('Las existencias previas no pueden ser negativas.')
  const base = costoEfectivo(previa.promedio, previa.referencia)
  if (previa.unidades === 0 || base === null) return entrada.costo
  const total = BigInt(previa.unidades + entrada.unidades)
  return dividirRedondeando(BigInt(previa.unidades) * base + BigInt(entrada.unidades) * entrada.costo, total)
}

// ── Corregir el costo promedio ───────────────────────────────────────────────

export type ResultadoCorreccion = { ok: true; costo: Costo; motivo: string } | { ok: false; codigo: string; error: string }

/** Una corrección lleva el costo nuevo y un motivo escrito: cambiar el valor del inventario sin explicación es un descuadre sin explicar. */
export function validarCorreccionDeCosto(costo: unknown, motivo: unknown): ResultadoCorreccion {
  const c = parsearCosto(costo)
  if (!c.ok) return { ok: false, codigo: 'COSTO_INVALIDO', error: c.error }
  if (typeof motivo !== 'string') return { ok: false, codigo: 'MOTIVO_OBLIGATORIO', error: 'Escribe el motivo de la corrección.' }
  const m = motivo.trim().replace(/\s+/g, ' ')
  if (m === '') return { ok: false, codigo: 'MOTIVO_OBLIGATORIO', error: 'Escribe el motivo de la corrección: cambiar el costo cambia el valor del inventario.' }
  if (m.length > MAX_MOTIVO_COSTO) return { ok: false, codigo: 'MOTIVO_INVALIDO', error: `El motivo no puede pasar de ${MAX_MOTIVO_COSTO} caracteres.` }
  return { ok: true, costo: c.valor, motivo: m }
}

// ── Qué movimientos se valoran ───────────────────────────────────────────────

/**
 * Los tipos de movimiento que, si nadie dice otra cosa, se valoran con el costo
 * promedio vigente. Una ENTRADA (`PURCHASE`) se valora con el costo que se
 * capturó —o con ninguno—; las reservas y las transferencias no se valoran (no
 * cambian lo que la empresa tiene ni lo que costó).
 */
export const TIPOS_VALORADOS_AL_PROMEDIO = new Set(['SALE', 'RETURN', 'DAMAGE', 'ADJUSTMENT'])

// ── El informe de valor ──────────────────────────────────────────────────────

export interface FilaValor {
  unidades: number
  /** null = el producto no tiene costo. */
  costo: Costo | null
}

export interface ResumenValor {
  /** Unidades que tienen costo. */
  unidadesConCosto: number
  /** Unidades de productos sin costo: están en existencia pero no se pueden valorar. */
  unidadesSinCosto: number
  productosSinCosto: number
  valor: Costo
}

/** Suma el valor de unas filas; lo que no tiene costo NO suma (ni como cero: se cuenta aparte). */
export function resumirValor(filas: readonly FilaValor[]): ResumenValor {
  const r: ResumenValor = { unidadesConCosto: 0, unidadesSinCosto: 0, productosSinCosto: 0, valor: BigInt(0) }
  for (const f of filas) {
    if (f.unidades <= 0) continue
    if (f.costo === null) {
      r.unidadesSinCosto += f.unidades
      r.productosSinCosto++
    } else {
      r.unidadesConCosto += f.unidades
      r.valor += valorDe(f.unidades, f.costo)
    }
  }
  return r
}
