import type { Href } from 'expo-router'

const INTERNAL_ORIGIN = 'https://membego.invalid'

const STATIC_ROUTES: Readonly<Record<string, Href>> = {
  '/cliente/ajustes': '/ajustes',
  '/cliente/ayuda': '/ayuda',
  '/cliente/citas': '/citas',
  '/cliente/empresas': '/empresas',
  '/cliente/explorar': '/explorar',
  '/cliente/historial': '/historial',
  '/cliente/intereses': '/intereses',
  '/cliente/invita-y-gana': '/invita-y-gana',
  '/cliente/membresia': '/mis-membresias',
  '/cliente/mis-excursiones': '/mis-excursiones',
  '/cliente/mis-membresias': '/mis-membresias',
  '/cliente/mis-promociones': '/mis-promociones',
  '/cliente/pagos': '/pagos',
  '/cliente/perfil': '/(tabs)/cuenta',
  '/cliente/planes': '/planes',
  '/cliente/promociones': '/promociones',
  '/cliente/regalos': '/regalos',
  '/ajustes': '/ajustes',
  '/ayuda': '/ayuda',
  '/citas': '/citas',
  '/empresas': '/empresas',
  '/explorar': '/explorar',
  '/historial': '/historial',
  '/intereses': '/intereses',
  '/invita-y-gana': '/invita-y-gana',
  '/mis-excursiones': '/mis-excursiones',
  '/mis-membresias': '/mis-membresias',
  '/mis-promociones': '/mis-promociones',
  '/novedades': '/novedades',
  '/pagos': '/pagos',
  '/planes': '/planes',
  '/promociones': '/promociones',
  '/regalos': '/regalos',
}

function safePathSegment(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value)
    return /^[\p{L}\p{N}_-]+$/u.test(decoded) ? decoded : null
  } catch {
    return null
  }
}

export function resolveNotificationHref(value: string | null): Href | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return null
  }

  let pathname: string
  try {
    const url = new URL(value, INTERNAL_ORIGIN)
    if (url.origin !== INTERNAL_ORIGIN) return null
    pathname = url.pathname
  } catch {
    return null
  }

  const staticRoute = Object.hasOwn(STATIC_ROUTES, pathname)
    ? STATIC_ROUTES[pathname]
    : null
  if (staticRoute) return staticRoute

  const paths = pathname.split('/').filter(Boolean)
  const segments = paths[0] === 'cliente' ? paths.slice(1) : paths

  if (segments.length === 2) {
    const id = safePathSegment(segments[1])
    if (!id) return null

    switch (segments[0]) {
      case 'ayuda':
        return { pathname: '/ayuda/[id]', params: { id } }
      case 'empresas':
        return { pathname: '/empresas/[companySlug]', params: { companySlug: id } }
      case 'mis-excursiones':
        return { pathname: '/mis-excursiones/[reservaId]', params: { reservaId: id } }
      case 'mis-promociones':
        return { pathname: '/mis-promociones/[id]', params: { id } }
      case 'membresia':
        return { pathname: '/membresia/[membresiaId]', params: { membresiaId: id } }
      case 'planes':
        return { pathname: '/planes/[planId]', params: { planId: id } }
      case 'promociones':
        return { pathname: '/promociones/[id]', params: { id } }
      default:
        return null
    }
  }

  if (
    segments.length === 3 &&
    segments[0] === 'mis-promociones' &&
    segments[1] === 'regalo'
  ) {
    const invitadoId = safePathSegment(segments[2])
    return invitadoId
      ? { pathname: '/mis-promociones/regalo/[invitadoId]', params: { invitadoId } }
      : null
  }

  return null
}
