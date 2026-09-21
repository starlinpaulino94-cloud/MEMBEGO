/**
 * Mapeo de hrefs web/BFF → rutas RN existentes.
 *
 * El BFF devuelve hrefs del web (`/cliente/promociones/123`, `/plan/abc`, ...).
 * La app RN tiene rutas propias (`/promociones/[id]`, `/planes`, ...). Este
 * helper es el único punto de traducción para que ningún link quede muerto.
 */
const MAPA: Record<string, string> = {
  '/cliente/empresas': '/empresas',
  '/cliente/promociones': '/promociones',
  '/cliente/citas': '/citas',
  '/cliente/mis-excursiones': '/mis-excursiones',
  '/cliente/historial': '/historial',
  '/cliente/pagos': '/pagos',
  '/cliente/ayuda': '/ayuda',
  '/cliente/ajustes': '/ajustes',
  '/cliente/planes': '/planes',
  '/cliente/explorar': '/explorar',
  '/cliente/intereses': '/intereses',
  '/cliente/perfil': '/(tabs)/cuenta',
  '/mis-membresias': '/mis-membresias',
  '/plan': '/planes',
  '/membresia': '/mis-membresias',
}

/**
 * Fallbacks explícitos: cuando la web tiene detalle pero RN no (plan detail),
 * redirigimos al listado con un query param que la pantalla destino usa para
 * mostrar un mensaje al usuario. NO son silenciosos: el usuario ve por qué
 * no llegó al detalle.
 *
 * /cliente/planes/[planId] → /planes?from=plan-detail: la app RN no tiene
 * pantalla de detalle de plan todavía (el BFF no expone GET /api/v1/cliente/planes/[id]).
 * El banner en PlanesScreen explica que se redirigió al listado.
 */
const FALLBACK_LISTA: Array<[prefix: string, destino: string]> = [
  ['/cliente/promociones/', '/promociones/'],
  ['/cliente/empresas/', '/empresas/'],
  ['/plan/', '/planes?from=plan-detail'],
  ['/cliente/planes/', '/planes?from=plan-detail'],
]

export function rnHref(href: string): string {
  if (!href) return href
  if (MAPA[href]) return MAPA[href]
  for (const [prefix, destino] of FALLBACK_LISTA) {
    if (href.startsWith(prefix)) return destino
  }
  // /empresas/{slug}/excursiones/{slug} → listado (sin detalle RN)
  if (href.startsWith('/empresas/') && href.includes('/excursiones/')) return '/excursiones'
  // /excursiones/buscar es ruta RN válida; solo los detalles caen al listado
  if (href.startsWith('/excursiones/') && href !== '/excursiones/buscar') return '/excursiones'
  return href
}