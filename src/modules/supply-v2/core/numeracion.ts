import type { Tx } from '@/lib/tenant'
import {
  formatearNumero as formatearNumeroGenerico,
  secuenciaDeNumero as secuenciaDeNumeroGenerico,
  siguienteNumero as siguienteNumeroGenerico,
  type BuscadorUltimo,
} from '@/lib/commerce-primitives/numeracion'

/**
 * MEMBEGO SUPPLY 2.0 · numeración correlativa SEGURA (§13).
 *
 * El cerrojo consultivo y el formato son genéricos y viven en
 * src/lib/commerce-primitives/numeracion.ts (Fase 0). Este módulo solo
 * declara el conjunto cerrado de prefijos de Supply V2 y envuelve las
 * funciones compartidas con ese tipo.
 *
 * Formato: `MBG-PO-2026-000001`, `MBG-RC-2026-000001`, `MBG-AG-2026-000001`,
 * `LOT-2026-000001`, `MBG-OF-2026-000001` (oferta), `MBG-SO-2026-000001` (orden de cliente).
 */

export type PrefijoNumeracion =
  | 'MBG-PO'
  | 'MBG-RC'
  | 'MBG-AG'
  | 'LOT'
  | 'MBG-OF'
  | 'MBG-SO'
  | 'MBG-RD'
  // Slice 4: factura, depósito, pago y obligación del proveedor; conciliación
  | 'MBG-SI'
  | 'MBG-SD'
  | 'MBG-SP'
  | 'MBG-OB'
  | 'MBG-RN'
  // Slice 5: liquidación a proveedor (comisión)
  | 'MBG-ST'
  // Slice 6: beneficio económico
  | 'MBG-BN'
  // Slice 7: campaña comercial
  | 'MBG-CP'
  // Slice 8: fidelización — programa, plan, membresía, recompensa, reclamación
  | 'MBG-FD'
  | 'MBG-MP'
  | 'MBG-MS'
  | 'MBG-RW'
  | 'MBG-RK'

export function formatearNumero(prefijo: PrefijoNumeracion, anio: number, secuencia: number): string {
  return formatearNumeroGenerico(prefijo, anio, secuencia)
}

export function secuenciaDeNumero(numero: string): number {
  return secuenciaDeNumeroGenerico(numero)
}

export type { BuscadorUltimo }

/**
 * Siguiente número para un prefijo dentro de la transacción `tx`.
 * `ultimo` recibe el prefijo con año (`MBG-PO-2026-`) y devuelve el número
 * más alto que ya exista con ese prefijo, o `null`.
 */
export async function siguienteNumero(
  tx: Tx,
  prefijo: PrefijoNumeracion,
  ultimo: BuscadorUltimo,
  fecha = new Date()
): Promise<string> {
  // `supply_v2` es la clave de cerrojo que este módulo siempre ha usado: no se
  // cambia (ver el parámetro `namespace` en commerce-primitives/numeracion.ts).
  return siguienteNumeroGenerico(tx, prefijo, ultimo, fecha, 'supply_v2')
}
