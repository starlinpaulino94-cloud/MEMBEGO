import type { Tx } from '@/lib/tenant'

/**
 * MEMBEGO SUPPLY · numeración correlativa SEGURA (§13).
 *
 * PROHIBIDO `count() + 1`: dos altas simultáneas leen el mismo conteo y la
 * segunda choca con el índice único.
 *
 * Aquí se toma un cerrojo consultivo DE TRANSACCIÓN por prefijo
 * (`pg_advisory_xact_lock`): la segunda transacción espera a que la primera
 * confirme, y solo entonces lee el último número —que ya incluye el que la
 * primera acaba de escribir—. Es de transacción y no de sesión a propósito:
 * `sinEmpresa` ejecuta todo el callback en UNA conexión, y el cerrojo se
 * suelta solo al confirmar o deshacer. El índice único de la columna sigue
 * siendo la última red.
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
  return `${prefijo}-${anio}-${String(secuencia).padStart(6, '0')}`
}

export function secuenciaDeNumero(numero: string): number {
  const m = numero.match(/-(\d{6,})$/)
  return m ? Number(m[1]) : 0
}

type BuscadorUltimo = (prefijoCompleto: string) => Promise<string | null>

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
  const anio = fecha.getFullYear()
  const clave = `supply_v2:${prefijo}:${anio}`
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${clave}))`
  const previo = await ultimo(`${prefijo}-${anio}-`)
  const secuencia = (previo ? secuenciaDeNumero(previo) : 0) + 1
  return formatearNumero(prefijo, anio, secuencia)
}
