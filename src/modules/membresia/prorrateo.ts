import { differenceInCalendarDays } from 'date-fns'

/**
 * PRORRATEO DEL CAMBIO DE PLAN (decisión de negocio, 18-09-2026).
 *
 * Cuando un cliente con membresía ACTIVA sube de plan, no se le cobra el plan
 * nuevo completo: se le reconoce por TIEMPO lo que le queda del período que ya
 * pagó. El crédito vale `precioVigente × (díasRestantes / vigenciaDias)` y el
 * importe a pagar es la diferencia contra el plan nuevo.
 *
 * Es TIEMPO, no usos: si le quedan 15 de 30 días, se le devuelve la mitad del
 * precio vigente aunque haya gastado todos los lavados. Un plan ilimitado no
 * cambia la regla — el criterio sigue siendo los días que faltan.
 *
 * ESTA ES LA ÚNICA FUENTE DEL CÁLCULO. La pantalla que enseña el desglose, el
 * cobro con tarjeta, la caja y la aprobación del cambio consumen esta función;
 * ninguna reimplementa la fórmula ni acepta un importe del navegador.
 */

export interface PagoCambioPlan {
  /** Precio del plan al que el cliente quiere subir. */
  precioNuevo: number
  /** Crédito por el tiempo que le queda al período vigente. */
  credito: number
  /** Lo que debe pagar: `max(0, precioNuevo − credito)`. */
  aPagar: number
}

export interface EntradaProrrateo {
  precioNuevo: number
  precioVigente: number
  /** Fin del período vigente. Sin fecha no hay tiempo que reconocer. */
  fechaVencimiento: Date | null | undefined
  /** Duración del período vigente, en días. */
  vigenciaDias: number | null | undefined
  /** Momento del cálculo. Inyectable en las pruebas. */
  ahora?: Date
}

/** Redondeo a la unidad de moneda (dos decimales). */
function aMoneda(valor: number): number {
  return Math.round(valor * 100) / 100
}

function numeroNoNegativo(valor: number): number {
  return Number.isFinite(valor) ? Math.max(0, aMoneda(valor)) : 0
}

export function calcularPagoCambioPlan(input: EntradaProrrateo): PagoCambioPlan {
  const precioNuevo = numeroNoNegativo(input.precioNuevo)
  const precioVigente = numeroNoNegativo(input.precioVigente)
  const ahora = input.ahora ?? new Date()

  const vigenciaDias = input.vigenciaDias
  const hayVigencia =
    typeof vigenciaDias === 'number' && Number.isFinite(vigenciaDias) && vigenciaDias > 0

  // Sin fecha de vencimiento no hay "tiempo restante" que reconocer: crédito 0,
  // y el cliente paga el plan nuevo completo (el mismo caso que la pantalla
  // ya trataba como precio completo).
  const diasRestantes =
    input.fechaVencimiento != null
      ? differenceInCalendarDays(input.fechaVencimiento, ahora)
      : 0

  const creditoBruto =
    input.fechaVencimiento != null && hayVigencia && diasRestantes > 0
      ? precioVigente * (diasRestantes / vigenciaDias)
      : 0

  // Acotado a [0, precioNuevo]: el crédito nunca supera lo que se cobra, así
  // que `aPagar` jamás queda negativo.
  const credito = aMoneda(Math.min(creditoBruto, precioNuevo))
  const aPagar = aMoneda(Math.max(0, precioNuevo - credito))

  return { precioNuevo, credito, aPagar }
}
