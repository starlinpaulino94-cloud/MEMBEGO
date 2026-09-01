import { NextResponse, type NextRequest } from 'next/server'
import { completarOauth } from '@/modules/connect/oauth'
import { configOauthDe, redirectUriDeCallback } from '@/modules/connect/oauthRutas'

export const dynamic = 'force-dynamic'

/**
 * VUELTA del proveedor OAuth.
 *
 * PÚBLICA por necesidad —el usuario llega desde el dominio del proveedor y su
 * sesión de MembeGo puede haberse perdido por el camino— y por eso no se fía
 * de nada de la URL salvo lo que puede verificar:
 *
 *   · el `state` va FIRMADO (si no cuadra, ni se consulta la base);
 *   · la fila del estado es de UN SOLO USO (se borra al canjear);
 *   · la `redirect_uri` se recalcula aquí, nunca se lee de la petición.
 *
 * El destino final se toma del estado guardado, no de la URL: así, ni siquiera
 * quien fabricara un callback podría usarnos para redirigir a donde quisiera.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const base = new URL('/admin/integraciones', req.nextUrl.origin)

  // El proveedor avisa de un rechazo con `error` (el usuario dijo que no, casi
  // siempre). No es una avería: se vuelve al panel con el motivo.
  const errorProveedor = params.get('error')
  if (errorProveedor) {
    base.searchParams.set('oauth', 'cancelado')
    return NextResponse.redirect(base)
  }

  const state = params.get('state') ?? ''
  const code = params.get('code') ?? ''
  if (!state || !code) {
    base.searchParams.set('oauth', 'incompleto')
    return NextResponse.redirect(base)
  }

  const res = await completarOauth({
    state,
    code,
    redirectUri: redirectUriDeCallback(),
    configDe: configOauthDe,
  })

  if (!res.ok) {
    base.searchParams.set('oauth', res.motivo === 'proveedor_rechazo' ? 'rechazado' : 'invalido')
    return NextResponse.redirect(base)
  }

  const destino = new URL(res.volverA ?? '/admin/integraciones', req.nextUrl.origin)
  destino.searchParams.set('oauth', 'conectado')
  return NextResponse.redirect(destino)
}
