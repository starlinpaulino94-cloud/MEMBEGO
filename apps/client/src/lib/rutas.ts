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
  '/cliente/bienvenida': '/bienvenida',
  '/cliente/intereses': '/intereses',
  '/cliente/perfil': '/(tabs)/cuenta',
  '/mis-membresias': '/mis-membresias',
  '/plan': '/planes',
  '/membresia': '/mis-membresias',
}

const FALLBACK_LISTA: Array<[prefix: string, destino: string]> = [
  ['/cliente/promociones/', '/promociones/'],
  ['/cliente/empresas/', '/empresas/'],
]

export function rnHref(href: string): string {
  if (!href) return href
  if (MAPA[href]) return MAPA[href]
  if (href.startsWith('/cliente/planes/')) return `/planes/${href.slice('/cliente/planes/'.length)}`
  if (href.startsWith('/plan/')) return `/planes/${href.slice('/plan/'.length)}`
  if (href.startsWith('/cliente/membresia/')) return `/membresia/${href.slice('/cliente/membresia/'.length)}`
  if (href.startsWith('/cliente/membresias/')) return `/membresia/${href.slice('/cliente/membresias/'.length)}`
  if (href.startsWith('/membresia/')) return href
  for (const [prefix, destino] of FALLBACK_LISTA) {
    if (href.startsWith(prefix)) return `${destino}${href.slice(prefix.length)}`
  }
  // /empresas/{slug}/excursiones/{slug} → listado (sin detalle RN)
  if (href.startsWith('/empresas/') && href.includes('/excursiones/')) return '/excursiones'
  // /excursiones/buscar es ruta RN válida; solo los detalles caen al listado
  if (href.startsWith('/excursiones/') && href !== '/excursiones/buscar') return '/excursiones'
  return href
}
