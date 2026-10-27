/**
 * Adónde vuelve la persona de la verificación de identidad abierta en el navegador del teléfono.
 *
 * Es el `scheme` de `app.json` y la dirección que el servidor manda al crear la sesión
 * (`RETORNO_APP_IDENTIDAD`): una prueba (`tests/identidad-pantalla-app.test.ts`) fija que coinciden.
 *
 * EL RETORNO NO DICE QUÉ PASÓ. Solo avisa de que la persona volvió: la pantalla responde pidiéndole el estado al
 * servidor, que es quien sabe el resultado (la app nunca decide si alguien quedó verificado). Por eso, aunque el
 * enlace venga alterado, lo peor que provoca es una consulta de estado.
 */
export const IDENTIDAD_RETURN_URL = 'membego://identidad/retorno' as const

/** ¿Es la vuelta de la verificación? Igualdad exacta, o seguida de `?`, `/` o `#` (el router a veces entrega solo la ruta). */
export function isIdentidadReturn(url: string): boolean {
  return url === IDENTIDAD_RETURN_URL || /^membego:\/\/identidad\/retorno(?:[/?#]|$)/.test(url) || /^\/?identidad\/retorno(?:[/?#]|$)/.test(url)
}

/**
 * ¿El retorno es de ESTE intento? Lee a mano `intento` y `nonce` del query (sin `URL`, que en Hermes no siempre está) y exige
 * que cada clave aparezca UNA sola vez y coincida con lo que devolvió el servidor al crear la sesión.
 */
export function retornoEsDeEsteIntento(url: string, esperado: { intentoId: string; nonce: string | null }): boolean {
  if (!isIdentidadReturn(url)) return false
  const consulta = url.split('#')[0].split('?')[1] ?? ''
  const valores = new Map<string, string>()
  for (const par of consulta.split('&')) {
    if (!par) continue
    const i = par.indexOf('=')
    const clave = decodeURIComponent(i < 0 ? par : par.slice(0, i))
    const valor = decodeURIComponent(i < 0 ? '' : par.slice(i + 1))
    if (valores.has(clave)) return false
    valores.set(clave, valor)
  }
  if (valores.get('intento') !== esperado.intentoId) return false
  return esperado.nonce === null ? !valores.has('nonce') || valores.get('nonce') === '' : valores.get('nonce') === esperado.nonce
}
