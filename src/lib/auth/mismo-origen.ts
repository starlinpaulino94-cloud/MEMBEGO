/**
 * `true` si una petición de ESCRITURA que se apoya en la cookie de sesión
 * viene de nuestra propia página.
 *
 * Los Route Handlers no traen la protección CSRF que sí tienen las Server
 * Actions. Para una ruta que acepta la cookie (sin Bearer), esto es la
 * barrera: `Sec-Fetch-Site` lo pone el navegador y no se puede falsificar
 * desde una página; `Origin` viaja en todo POST/DELETE. Sin ninguno de los dos
 * (clientes que no son navegadores, pruebas) se deja pasar: no tienen cookie
 * que robar.
 */
export function esDelMismoOrigen(request: Request): boolean {
  const sitio = request.headers.get('sec-fetch-site')
  if (sitio && sitio !== 'same-origin' && sitio !== 'none') return false
  const origen = request.headers.get('origin')
  if (!origen) return true
  try {
    return new URL(origen).host === new URL(request.url).host
  } catch {
    return false
  }
}
