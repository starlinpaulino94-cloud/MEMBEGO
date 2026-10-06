/**
 * COMMERCE PRIMITIVES · fábrica de máquinas de estado.
 *
 * Una transición que no esté declarada en la tabla NO OCURRE. PURO: se prueba
 * sin base de datos.
 *
 * Genérico sobre el enum de estados (`E extends string`): cada dominio
 * (Supply V2, MembegoOrder, Redemption, Deal, Campaign) declara su propia
 * tabla de transiciones y usa estas tres funciones en lugar de reimplementar
 * el patrón. Extraído de supply-v2/core/estados.ts (Fase 0) — las tablas de
 * transición específicas de Supply V2 permanecen en ese módulo.
 */

export type Transiciones<E extends string> = Record<E, readonly E[]>

export function puedeTransicionar<E extends string>(tabla: Transiciones<E>, desde: E, hasta: E): boolean {
  return tabla[desde].includes(hasta)
}

export function exigirTransicion<E extends string>(
  tabla: Transiciones<E>,
  desde: E,
  hasta: E,
  entidad: string
): void {
  if (!puedeTransicionar(tabla, desde, hasta)) {
    throw new Error(`${entidad}: no se puede pasar de ${desde} a ${hasta}.`)
  }
}
