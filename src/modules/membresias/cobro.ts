/**
 * COBRO DE MEMBRESÍAS EN MOSTRADOR — vocabulario y reglas puras.
 *
 * Este archivo NO importa `server-only`: lo usan la acción del servidor, el
 * formulario del navegador y las pruebas. Que la regla viva en un solo sitio
 * es lo que evita que el formulario acepte algo que el servidor rechaza (o
 * peor: al revés).
 */

export const METODOS_COBRO_MEMBRESIA = [
  'EFECTIVO',
  'TARJETA',
  'TRANSFERENCIA',
  'DEPOSITO',
  'LINK',
] as const

export type MetodoCobroMembresia = (typeof METODOS_COBRO_MEMBRESIA)[number]

export const METODO_COBRO_LABEL: Record<MetodoCobroMembresia, string> = {
  EFECTIVO: 'Efectivo',
  TARJETA: 'Tarjeta',
  TRANSFERENCIA: 'Transferencia',
  DEPOSITO: 'Depósito',
  LINK: 'Link de pago',
}

/**
 * ¿Este método necesita referencia?
 *
 * Todo lo que no es efectivo deja rastro en un banco, y conciliar ese rastro
 * exige un número. Pedirlo en el momento del cobro cuesta cinco segundos;
 * buscarlo tres semanas después, cuando no cuadra la caja, cuesta una tarde.
 */
export function exigeReferencia(metodo: string): boolean {
  return metodo.trim().toUpperCase() !== 'EFECTIVO'
}

/** Motivo por el que un cobro no se puede registrar, o `null` si es válido. */
export function validarCobroMembresia(input: {
  pagoRecibido: boolean
  metodo: string
  referencia: string
}): string | null {
  if (!input.pagoRecibido) {
    return 'Marca que ya recibiste el pago del cliente antes de aplicar la renovación.'
  }
  const metodo = input.metodo.trim().toUpperCase()
  if (!(METODOS_COBRO_MEMBRESIA as readonly string[]).includes(metodo)) {
    return 'Indica cómo se pagó la renovación.'
  }
  if (exigeReferencia(metodo) && !input.referencia.trim()) {
    return 'Los pagos que no son en efectivo necesitan su referencia para poder conciliarlos.'
  }
  return null
}
