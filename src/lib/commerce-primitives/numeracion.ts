import type { Tx } from '@/lib/tenant'

/**
 * COMMERCE PRIMITIVES · numeración correlativa SEGURA.
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
 * Formato: `<PREFIJO>-<AÑO>-<SECUENCIA>`, p.ej. `MBG-PO-2026-000001`.
 *
 * Genérico sobre el prefijo (`P extends string`): cada dominio define su
 * propio tipo cerrado de prefijos (Supply V2, MembegoOrder, etc.) y usa esta
 * numeración compartida en lugar de reimplementar el cerrojo. Extraído de
 * supply-v2/core/numeracion.ts (Fase 0).
 */

export function formatearNumero<P extends string>(prefijo: P, anio: number, secuencia: number): string {
  return `${prefijo}-${anio}-${String(secuencia).padStart(6, '0')}`
}

export function secuenciaDeNumero(numero: string): number {
  const m = numero.match(/-(\d{6,})$/)
  return m ? Number(m[1]) : 0
}

export type BuscadorUltimo = (prefijoCompleto: string) => Promise<string | null>

/**
 * Siguiente número para un prefijo dentro de la transacción `tx`.
 * `ultimo` recibe el prefijo con año (`MBG-PO-2026-`) y devuelve el número
 * más alto que ya exista con ese prefijo, o `null`.
 */
export async function siguienteNumero<P extends string>(
  tx: Tx,
  prefijo: P,
  ultimo: BuscadorUltimo,
  fecha = new Date(),
  /**
   * Espacio de nombres del cerrojo. Dos dominios que compartan un prefijo no
   * deben compartir cerrojo; y un dominio que ya tenía numeración en producción
   * DEBE conservar su clave exacta: si cambia, durante un despliegue gradual la
   * instancia vieja y la nueva toman cerrojos distintos para el mismo prefijo y
   * una choca con el índice único. Supply V2 pasa `supply_v2`.
   */
  namespace = 'commerce'
): Promise<string> {
  const anio = fecha.getFullYear()
  const clave = `${namespace}:${prefijo}:${anio}`
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${clave}))`
  const previo = await ultimo(`${prefijo}-${anio}-`)
  const secuencia = (previo ? secuenciaDeNumero(previo) : 0) + 1
  return formatearNumero(prefijo, anio, secuencia)
}
