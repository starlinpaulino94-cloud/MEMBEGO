import { randomUUID } from 'crypto'

/**
 * PLATAFORMA · Fase 5 — SSO, NÚCLEO PURO.
 *
 * Sin Prisma ni `server-only`: lo que decide si una `returnUrl` es segura y
 * cómo se genera un identificador de token se puede probar al milímetro, con
 * vectores fijos y sin base de datos. El envoltorio que registra los canjes
 * vive en `sso.ts`.
 */

/** TTL del token SSO. Corto: es una credencial al portador dentro de una URL. */
export const TTL_SSO_SEGUNDOS = 90

export function nuevoJti(): string {
  return `sso_${randomUUID().replace(/-/g, '')}`
}


// ── returnUrl ───────────────────────────────────────────────────────────────

/**
 * ¿Está esta `returnUrl` DENTRO del sistema al que vamos?
 *
 * Sin esta comprobación, `?returnUrl=https://sitio-malo/` convertiría el SSO de
 * MembeGo en un redirector abierto: el usuario pulsa un enlace de MembeGo,
 * MembeGo lo autentica y lo manda a donde diga el atacante — con nuestra
 * credibilidad detrás y, peor, con un token válido en la URL.
 *
 * Se compara ORIGEN, no prefijo de cadena. `https://carwash.membego.com.malo/`
 * empieza por `https://carwash.membego.com` y no tiene nada que ver con él; es
 * el fallo clásico de validar redirecciones con `startsWith`.
 */
export function returnUrlValida(returnUrl: string | null | undefined, urlBase: string): string | null {
  if (!returnUrl) return null
  try {
    const destino = new URL(returnUrl)
    const base = new URL(urlBase)
    if (destino.origin !== base.origin) return null
    // http:// hacia un satélite en https es una degradación silenciosa.
    if (destino.protocol !== base.protocol) return null
    return destino.toString()
  } catch {
    return null
  }
}
