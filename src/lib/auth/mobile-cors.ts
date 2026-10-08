import { appUrl, getAppUrl } from '@/lib/site'

function configuredOrigins(): Set<string> {
  const origins = [
    ...[process.env.CLIENT_APP_ORIGINS, process.env.NEXT_PUBLIC_CLIENT_APP_ORIGINS]
      .filter(Boolean)
      .flatMap((value) => value!.split(',')),
    getAppUrl(),
    appUrl(),
  ]
  return new Set(origins.flatMap((value) => {
    try { return [new URL(value.trim()).origin] } catch { return [] }
  }))
}

function isAllowedOrigin(origin: string): boolean {
  if (configuredOrigins().has(origin)) return true
  if (process.env.NODE_ENV !== 'development') return false
  try {
    const url = new URL(origin)
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  } catch {
    return false
  }
}

export function mobileCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin') ?? ''
  return {
    ...(isAllowedOrigin(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  }
}

export function handleMobileCorsPreflight(request: Request): Response {
  return new Response(null, { status: 204, headers: mobileCorsHeaders(request) })
}
