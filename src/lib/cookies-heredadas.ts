/**
 * LIMPIEZA DE LAS COOKIES DE SESIÓN HEREDADAS (separación landing/app · F8).
 *
 * Hoy la cookie de sesión de Supabase (`sb-<ref>-auth-token`, a veces partida en `.0`, `.1`…) es *host-only* en
 * `membego.com`. Al activar `NEXT_PUBLIC_COOKIE_DOMAIN=.membego.com`, los inicios de sesión nuevos escriben la misma cookie
 * con `Domain=.membego.com`, y el navegador guarda las dos a la vez: la vieja (solo `membego.com`) y la nueva (compartida).
 * Next arma el mapa de cookies de la petición por nombre, de modo que, si la vieja trae un trozo (`.1`) que la nueva ya no
 * necesita, el servidor une trozos de dos sesiones distintas y la sesión parece corrupta.
 *
 * La vieja ya no sirve para nada: la app vive en otro host y no la recibe. Se borra UNA vez por navegador y por host:
 * un `Set-Cookie` sin `Domain` solo toca la cookie *host-only*, no la compartida. Un marcador *host-only* (`mg_cd`)
 * evita repetirlo en cada petición, y mantiene la landing estática: solo responde con cookies quien trae sesión, y una vez.
 *
 * Todo esto es PURO: recibe los nombres de las cookies de la petición y devuelve las líneas `Set-Cookie` (o ninguna).
 */

import type { Anfitrion } from '@/lib/anfitriones'

/** Marca «este navegador ya se limpió en este host». Host-only a propósito: cada host limpia lo suyo. */
export const MARCADOR_LIMPIEZA = 'mg_cd'
const UN_ANIO = 60 * 60 * 24 * 365

/** La cookie de sesión de Supabase, entera o por trozos. (No el verificador PKCE: vive minutos y no se comparte.) */
const COOKIE_DE_SESION = /^sb-.+-auth-token(?:\.\d+)?$/

export interface EntradaDeLimpieza {
  /** Nombres de las cookies que trae la petición. */
  nombres: readonly string[]
  /** `sessionCookieDomain()`: sin dominio compartido no hay nada que limpiar. */
  dominioCompartido: string | undefined
  /** Qué host es este (`null` en localhost, previews…: ahí no se hace nada). */
  anfitrion: Anfitrion | null
  /** Interruptor de emergencia (`ANFITRIONES_LIMPIAR_COOKIES_HEREDADAS=0`). */
  habilitada?: boolean
}

/** Las líneas `Set-Cookie` que borran las cookies de sesión *host-only* y dejan el marcador, o `[]` si no toca. */
export function cookiesHeredadasALimpiar(entrada: EntradaDeLimpieza): string[] {
  if (entrada.habilitada === false || !entrada.dominioCompartido || !entrada.anfitrion) return []
  if (entrada.nombres.includes(MARCADOR_LIMPIEZA)) return []
  const sesion = [...new Set(entrada.nombres.filter((n) => COOKIE_DE_SESION.test(n)))]
  if (sesion.length === 0) return []
  return [
    ...sesion.map((nombre) => `${nombre}=; Max-Age=0; Path=/; SameSite=Lax`),
    `${MARCADOR_LIMPIEZA}=1; Max-Age=${UN_ANIO}; Path=/; SameSite=Lax`,
  ]
}
