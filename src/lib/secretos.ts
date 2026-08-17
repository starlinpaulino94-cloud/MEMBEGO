import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * Comparación de secretos en tiempo constante.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ EVITA
 *
 * `a === b` sobre cadenas para en el primer carácter que difiere. La
 * diferencia de tiempo es minúscula, pero es MEDIBLE y depende de cuántos
 * caracteres se acertaron: repitiendo la petición se puede reconstruir el
 * secreto carácter a carácter sin conocerlo de antemano.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ SE HASHEA ANTES
 *
 * `timingSafeEqual` exige búferes del MISMO tamaño y lanza si no lo son —así
 * que usarla en crudo obligaría a comparar longitudes primero, y esa
 * comparación filtra el largo del secreto. Pasar ambos por SHA-256 los deja en
 * 32 bytes siempre: no se filtra ni el contenido ni la longitud.
 *
 * Vivía como función privada dentro de `bootstrap-guard.ts`, donde ningún otro
 * módulo podía alcanzarla; por eso los tres crons acabaron comparando con
 * `!==`. Al sacarla, la forma correcta es la que está a mano.
 */
export function comparacionConstante(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}
