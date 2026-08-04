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
export async function GET(_req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const user = await getUser()
  if (!user || !ROLES_EQUIPO.has(user.metadata.role)) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 401 })
  }
  const { slug } = await ctx.params
  const res = await urlAperturaSSO(slug, user)
  if ('error' in res) {
    return NextResponse.json({ error: res.error }, { status: 400 })
  }
  return NextResponse.redirect(res.url, { status: 302 })
}
