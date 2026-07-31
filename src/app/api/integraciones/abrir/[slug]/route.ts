import { NextResponse, type NextRequest } from 'next/server'
import { getUser } from '@/lib/auth'
import { urlAperturaSSO } from '@/modules/integraciones/sso'

export const dynamic = 'force-dynamic'

// Roles del EQUIPO que pueden abrir un sistema satélite (los clientes no:
// ellos viven en MembeGo; el satélite es la herramienta operativa del equipo).
const ROLES_EQUIPO = new Set(['SUPERADMIN', 'ADMIN_EMPRESA', 'GERENTE', 'RECEPCION', 'EMPLEADO'])

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
