/**
 * COORDENADAS DESDE UN ENLACE DE GOOGLE MAPS.
 *
 * El dueño de un negocio ya tiene su ubicación en Google Maps; pedirle que
 * además arrastre un pin es hacerle repetir un dato que ya dio. Este módulo
 * extrae la latitud/longitud del enlace pegado, en los formatos que Google
 * produce de verdad:
 *
 *   · `!3d18.48!4d-69.93`  — el PIN del lugar (data del place). El más fiable:
 *     es el punto del negocio, no el centro de la vista.
 *   · `?q=18.48,-69.93` / `?ll=` / `?query=` — enlaces de búsqueda directa.
 *   · `@18.48,-69.93,15z`  — el centro del VISOR. El menos fiable (es donde
 *     estaba la cámara, no necesariamente el lugar), por eso va de último.
 *
 * Los enlaces CORTOS (`maps.app.goo.gl/…`) no llevan coordenadas: son una
 * redirección. Detectarlos es cosa de `esEnlaceCortoGoogleMaps`; expandirlos
 * requiere red y vive en el servidor (perfilActions), no aquí.
 *
 * Módulo puro sin dependencias: lo importan un componente de cliente (para
 * mover el pin al pegar) y la acción de servidor (red de seguridad al
 * guardar). Las pruebas fijan cada formato.
 */

export interface CoordenadasEnlace {
  lat: number
  lng: number
}

function valida(lat: number, lng: number): CoordenadasEnlace | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  // 0,0 es el «null island» de los datos basura, no un negocio.
  if (lat === 0 && lng === 0) return null
  return { lat, lng }
}

const NUM = String.raw`(-?\d{1,3}(?:\.\d+)?)`

export function coordenadasDeEnlaceGoogleMaps(url: string): CoordenadasEnlace | null {
  const s = (url ?? '').trim()
  if (!s) return null

  // 1) El pin del lugar: …!3d<lat>!4d<lng>…
  const pin = s.match(new RegExp(String.raw`!3d${NUM}!4d${NUM}`))
  if (pin) {
    const r = valida(Number(pin[1]), Number(pin[2]))
    if (r) return r
  }

  // 2) Parámetros de búsqueda: q= / ll= / query= / destination= (varias formas
  //    de compartir). El valor puede venir URL-encodeado («18.48%2C-69.93»).
  const params = s.match(
    new RegExp(String.raw`[?&](?:q|ll|query|destination)=${NUM}(?:,|%2C)\s*${NUM}`, 'i')
  )
  if (params) {
    const r = valida(Number(params[1]), Number(params[2]))
    if (r) return r
  }

  // 3) El centro del visor: /@<lat>,<lng>,…
  const visor = s.match(new RegExp(String.raw`/@${NUM},${NUM}`))
  if (visor) {
    const r = valida(Number(visor[1]), Number(visor[2]))
    if (r) return r
  }

  return null
}

/**
 * ¿Es un enlace corto de Google Maps (redirección sin coordenadas visibles)?
 * Expandirlo requiere seguir la redirección — eso es del servidor.
 */
export function esEnlaceCortoGoogleMaps(url: string): boolean {
  return /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs)\//i.test((url ?? '').trim())
}
