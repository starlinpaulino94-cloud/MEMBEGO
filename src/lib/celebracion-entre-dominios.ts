/**
 * La celebración de bienvenida cruza de la landing a la app (separación landing/app · F7).
 *
 * Tras registrarse por una campaña, la landing de invitación deja los datos de la celebración y manda a la persona a la
 * app. Con un solo dominio viajan en `sessionStorage`; con dos dominios `sessionStorage` NO cruza (es por origen), así que
 * además se deja una cookie de 2 minutos en el dominio compartido, que la app consume una sola vez. Es un realce: si no
 * llega (cookie bloqueada, demasiado grande), la persona entra igual a su app.
 */

export const CLAVE_CELEBRACION = 'membego_celebracion'
const SEGUNDOS_DE_VIDA = 120
/** Las cookies caben en ~4 KB por par nombre=valor; con margen para el nombre y los atributos. */
const MAXIMO_CODIFICADO = 3500

/** El valor de la cookie (sin nombre ni atributos), o `null` si no cabe. Pura: la prueban las unitarias. */
export function valorDeCookieDeCelebracion(json: string): string | null {
  const codificado = encodeURIComponent(json)
  return codificado.length <= MAXIMO_CODIFICADO ? codificado : null
}

/** La cabecera `Set-Cookie`/`document.cookie` completa. Pura. */
export function cookieDeCelebracion(json: string, opciones: { dominio?: string; seguro?: boolean }): string | null {
  const valor = valorDeCookieDeCelebracion(json)
  if (valor === null) return null
  return `${CLAVE_CELEBRACION}=${valor}; Path=/; Max-Age=${SEGUNDOS_DE_VIDA}; SameSite=Lax${opciones.dominio ? `; Domain=${opciones.dominio}` : ''}${opciones.seguro ? '; Secure' : ''}`
}

/** Deja la celebración para la app (navegador de la landing). */
export function guardarCelebracionParaLaApp(json: string, dominio: string | undefined): void {
  try {
    const cookie = cookieDeCelebracion(json, { dominio, seguro: window.location.protocol === 'https:' })
    if (cookie) document.cookie = cookie
  } catch {
    // Realce, no núcleo.
  }
}

/** Lee y borra la cookie de la celebración (navegador de la app). `null` si no hay. */
export function tomarCelebracionDeCookie(dominio: string | undefined): string | null {
  try {
    const par = document.cookie.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${CLAVE_CELEBRACION}=`))
    if (!par) return null
    document.cookie = `${CLAVE_CELEBRACION}=; Path=/; Max-Age=0; SameSite=Lax${dominio ? `; Domain=${dominio}` : ''}`
    return decodeURIComponent(par.slice(CLAVE_CELEBRACION.length + 1))
  } catch {
    return null
  }
}
