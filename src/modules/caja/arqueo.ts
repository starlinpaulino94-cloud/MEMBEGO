/**
 * Caja (POS) · ARQUEO — matemática pura del cierre de turno.
 *
 * Vivía dentro de `cerrarCaja` (server action), donde no se podía probar sin
 * base de datos. Extraída aquí para que `tests/caja.test.ts` la verifique:
 * es la cuenta que decide si a la caja le falta o le sobra dinero, y nadie
 * debería poder romperla en silencio.
 */

export interface EntradasArqueo {
  /** Fondo con el que se abrió el turno. */
  balanceInicial: number
  /** Cobros del turno hechos EN EFECTIVO (los otros métodos no entran a la gaveta). */
  cobrosEfectivo: number
  /** Movimientos de entrada de efectivo (aportes de fondo). */
  entradas: number
  /** Movimientos de salida (retiros, gastos, pagos a proveedor). */
  salidas: number
  /** Efectivo contado físicamente al cerrar. */
  balanceFinal: number
}

export type EstadoArqueo = 'CUADRADA' | 'SOBRANTE' | 'FALTANTE'

export interface ResultadoArqueo {
  /** Lo que DEBERÍA haber en la gaveta según el sistema. */
  balanceEsperado: number
  /** Contado − esperado. Positivo = sobra; negativo = falta. */
  diferencia: number
  estado: EstadoArqueo
}

/** Redondeo a centavos: evita que la coma flotante invente diferencias de 0.0000001. */
function centavos(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Arqueo del cierre: esperado = inicial + cobros en efectivo + entradas − salidas.
 * La diferencia contra lo contado es lo que se guarda en la sesión de caja.
 */
export function calcularArqueo(e: EntradasArqueo): ResultadoArqueo {
  const balanceEsperado = centavos(
    e.balanceInicial + e.cobrosEfectivo + e.entradas - e.salidas
  )
  const diferencia = centavos(e.balanceFinal - balanceEsperado)
  return {
    balanceEsperado,
    diferencia,
    estado: diferencia === 0 ? 'CUADRADA' : diferencia > 0 ? 'SOBRANTE' : 'FALTANTE',
  }
}

/** Texto para la auditoría y el mensaje al empleado ("cuadrada", "faltante RD$50.00"). */
export function etiquetaArqueo(diferencia: number): string {
  if (diferencia === 0) return 'cuadrada'
  return diferencia > 0
    ? `sobrante RD$${diferencia.toFixed(2)}`
    : `faltante RD$${Math.abs(diferencia).toFixed(2)}`
}
