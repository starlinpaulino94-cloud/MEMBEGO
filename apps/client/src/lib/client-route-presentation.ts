export type ClientRoutePresentation = 'navigation' | 'bare'

const CLIENT_DETAIL_ROUTE_PATTERNS: readonly RegExp[] = [
  /^\/citas$/,
  /^\/ayuda\/[^/]+$/,
  /^\/empresas\/[^/]+$/,
  /^\/historial$/,
  /^\/intereses$/,
  /^\/membresia\/[^/]+$/,
  /^\/mis-membresias$/,
  /^\/mis-promociones$/,
  /^\/mis-excursiones\/[^/]+$/,
  /^\/mis-promociones\/[^/]+$/,
  /^\/pagos$/,
  /^\/planes\/[^/]+$/,
  /^\/promociones\/[^/]+$/,
  /^\/vehiculos$/,
  /^\/vehiculos\/nuevo$/,
]

const BARE_ROUTE_EXACT: readonly string[] = [
  '/vehiculos/nuevo',
  '/cerca',
]

const BARE_ROUTE_PREFIXES: readonly string[] = [
  '/planes/',
  '/promociones/',
  '/membresia/',
  '/mis-promociones/',
  '/mis-excursiones/',
  '/empresas/',
  '/ayuda/',
  '/regalos/',
]

export function isClientDetailRoute(pathname: string): boolean {
  return CLIENT_DETAIL_ROUTE_PATTERNS.some((pattern) => pattern.test(pathname))
}

const PUBLIC_ROUTE_EXACT: readonly string[] = ['/']

const PUBLIC_ROUTE_PREFIXES: readonly string[] = [
  '/login',
  '/establecer-contrasena',
  '/bienvenida',
  '/bienvenida-ref',
  '/registro',
  '/eliminar-cuenta',
]

export function getClientRoutePresentation(
  pathname: string,
): ClientRoutePresentation {
  if (
    BARE_ROUTE_EXACT.includes(pathname) ||
    BARE_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  ) {
    return 'bare'
  }

  return 'navigation'
}

export function requiresClientAuthentication(pathname: string): boolean {
  if (PUBLIC_ROUTE_EXACT.includes(pathname)) return false

  return !PUBLIC_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}
