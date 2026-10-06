/**
 * COMMERCE PRIMITIVES · ledger genérico de cubetas (append-only).
 *
 * PURO: sin Prisma, sin base de datos. Decide qué asiento es válido y qué
 * deja en las cubetas.
 *
 * Un asiento es un TRASLADO: `quantity` unidades salen de `sourceBucket` y
 * entran en `destinationBucket`. Origen nulo = entran desde fuera; destino
 * nulo = salen definitivamente.
 *
 * EL INVARIANTE
 *
 *   totalEsperado = SUMA(todas las cubetas)
 *
 * Con traslados se cumple solo: cada asiento resta de una cubeta lo que suma
 * a otra. Los contadores son caché; la suma de asientos es la verdad.
 *
 * Genérico sobre el conjunto de cubetas (`B extends string`) y los tipos de
 * movimiento (`T extends string`): cada dominio (Supply V2, Inventory,
 * Merchant Ledger) declara sus propias cubetas y su propia tabla de
 * traslados permitidos, y usa estas funciones en vez de reimplementar el
 * patrón. Extraído de supply-v2/core/ledger.ts (Fase 0) — las cubetas y la
 * tabla de traslados específicas de Supply V2 permanecen en ese módulo.
 */

export type CubetasGenerico<B extends string> = Record<B, number>

export interface MovimientoGenerico<B extends string, T extends string> {
  type: T
  sourceBucket: B | null
  destinationBucket: B | null
  quantity: number
  reason?: string | null
}

export interface TraspasoPermitido<B extends string> {
  source: B | null
  destination: B | null
}

export function cubetasVaciasGenerico<B extends string>(buckets: readonly B[]): CubetasGenerico<B> {
  const vacio = {} as CubetasGenerico<B>
  for (const b of buckets) vacio[b] = 0
  return vacio
}

export function sumaCubetasGenerico<B extends string>(buckets: readonly B[], valores: CubetasGenerico<B>): number {
  return buckets.reduce((t, k) => t + valores[k], 0)
}

/**
 * Devuelve el mensaje de error o `null` si el asiento es válido en abstracto.
 *
 * `tipoComodin` (opcional) es un tipo de movimiento que se acepta con
 * cualquier origen/destino siempre que cumpla el motivo obligatorio (p.ej.
 * `ADJUSTMENT` en Supply V2: corrige un descuadre entre cubetas).
 */
export function validarMovimientoGenerico<B extends string, T extends string>(
  m: MovimientoGenerico<B, T>,
  movimientosPermitidos: Record<T, readonly TraspasoPermitido<B>[]>,
  tiposConMotivoObligatorio: readonly T[],
  tipoComodin?: T
): string | null {
  if (!Number.isInteger(m.quantity) || m.quantity <= 0) {
    return 'Un asiento del ledger mueve una cantidad entera positiva.'
  }
  if (m.sourceBucket === null && m.destinationBucket === null) {
    return 'Un asiento necesita al menos una cubeta de origen o de destino.'
  }
  if (tiposConMotivoObligatorio.includes(m.type) && !m.reason?.trim()) {
    return `Un asiento ${m.type} exige un motivo por escrito.`
  }
  if (tipoComodin !== undefined && m.type === tipoComodin) return null
  const permitidos = movimientosPermitidos[m.type]
  const ok = permitidos.some((p) => p.source === m.sourceBucket && p.destination === m.destinationBucket)
  return ok
    ? null
    : `Un asiento ${m.type} no puede ir de ${m.sourceBucket ?? 'fuera'} a ${m.destinationBucket ?? 'fuera'}.`
}

/**
 * Aplica un traslado y devuelve las cubetas resultantes. Lanza si el asiento
 * no es válido o dejaría una cubeta en negativo. No muta la entrada.
 */
export function aplicarMovimientoGenerico<B extends string, T extends string>(
  antes: CubetasGenerico<B>,
  m: MovimientoGenerico<B, T>,
  movimientosPermitidos: Record<T, readonly TraspasoPermitido<B>[]>,
  tiposConMotivoObligatorio: readonly T[],
  tipoComodin?: T
): CubetasGenerico<B> {
  const error = validarMovimientoGenerico(m, movimientosPermitidos, tiposConMotivoObligatorio, tipoComodin)
  if (error) throw new Error(error)
  const despues: CubetasGenerico<B> = { ...antes }
  if (m.sourceBucket) {
    if (despues[m.sourceBucket] < m.quantity) {
      throw new Error(`No hay ${m.quantity} unidades en ${m.sourceBucket}: solo ${despues[m.sourceBucket]}.`)
    }
    despues[m.sourceBucket] -= m.quantity
  }
  if (m.destinationBucket) despues[m.destinationBucket] += m.quantity
  return despues
}

/** Lo recibido según las cubetas: lo que entró menos lo que salió. */
export function saldoDeAsientosGenerico<B extends string>(
  buckets: readonly B[],
  asientos: readonly Pick<MovimientoGenerico<B, string>, 'sourceBucket' | 'destinationBucket' | 'quantity'>[]
): CubetasGenerico<B> {
  const saldo = cubetasVaciasGenerico(buckets)
  for (const a of asientos) {
    if (a.sourceBucket) saldo[a.sourceBucket] -= a.quantity
    if (a.destinationBucket) saldo[a.destinationBucket] += a.quantity
  }
  return saldo
}

/** El invariante: todas las cubetas no-negativas y su suma igual al total esperado. */
export function invarianteCumplidoGenerico<B extends string>(
  buckets: readonly B[],
  totalEsperado: number,
  valores: CubetasGenerico<B>
): boolean {
  return buckets.every((k) => valores[k] >= 0) && sumaCubetasGenerico(buckets, valores) === totalEsperado
}
