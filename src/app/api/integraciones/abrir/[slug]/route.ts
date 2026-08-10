import { NextResponse, type NextRequest } from 'next/server'
import { getUser } from '@/lib/auth'
import { urlAperturaSSO } from '@/modules/integraciones/sso'
import { ROLES_APP } from '@/types'

export const dynamic = 'force-dynamic'

/**
 * Roles del EQUIPO que pueden abrir un sistema satélite: TODOS menos CLIENTE.
 * Los clientes viven en MembeGo; el satélite es la herramienta del equipo.
 *
 * Se deriva de la lista de roles en vez de escribirla a mano: la versión
 * escrita a mano olvidaba ADMINISTRADOR (el nombre moderno de ADMIN_EMPRESA),
 * SUPERVISOR, CAJERO y MARKETING — o sea que al dueño de la empresa se le
 * negaba la entrada al satélite con un 401 sin explicación. Quién puede hacer
 * QUÉ dentro del satélite lo decide el satélite con el `rol` del token.
 */
const ROLES_EQUIPO = new Set<string>(ROLES_APP.filter((r) => r !== 'CLIENTE'))

/**
 * SSO de salida: GET /api/integraciones/abrir/carwash → 302 al sistema
 * satélite con un token firmado de 90 segundos. El satélite verifica el token
 * con el secreto compartido y crea su propia sesión (ver docs/INTEGRACIONES.md).
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const user = await getUser()
  if (!user || !ROLES_EQUIPO.has(user.metadata.role)) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 401 })
  }
  const { slug } = await ctx.params
  // `returnUrl` se valida contra la `urlBase` del sistema y viaja DENTRO del
  // token firmado. Una que no apunte al propio satélite se descarta sin más:
  // negarle la entrada al usuario por un parámetro manipulado castigaría a la
  // víctima en vez de al que lo manipuló.
  const res = await urlAperturaSSO(slug, user, {
    returnUrl: req.nextUrl.searchParams.get('returnUrl'),
  })
  if ('error' in res) {
    return NextResponse.json({ error: res.error }, { status: 400 })
  }
  return NextResponse.redirect(res.url, { status: 302 })
}
