import { NextResponse, type NextRequest } from 'next/server'
import { requireSection } from '@/lib/auth/guards'
import { iniciarOauth } from '@/modules/connect/oauth'
import {
  configOauthDe,
  destinoDeVueltaSeguro,
  redirectUriDeCallback,
} from '@/modules/connect/oauthRutas'

export const dynamic = 'force-dynamic'

/**
 * INICIA el flujo OAuth de un conector para la empresa del usuario.
 *
 * Es una ruta y no una server action porque termina en una REDIRECCIÓN a otro
 * dominio, y eso una action no lo hace bien: el navegador tiene que salir de
 * aquí con el `state` en la URL.
 *
 * La guardia es la misma del panel (`integraciones` · `webhook_crear` no, esto
 * es conectar una aplicación): quien puede administrar integraciones puede
 * conectar. La empresa sale de la sesión; el `conexionId` se comprueba contra
 * ella dentro de `iniciarOauth`.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params
  const user = await requireSection('integraciones')
  if (!user?.metadata.companyId) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 401 })
  }

  const config = configOauthDe(slug)
  if (!config) {
    // Todavía no hay conectores nativos (llegan en la Fase 6). Se dice, en vez
    // de mandar al usuario a una pantalla de consentimiento rota.
    return NextResponse.json(
      { error: 'Esa aplicación todavía no está disponible.' },
      { status: 404 }
    )
  }

  const conexionId = req.nextUrl.searchParams.get('conexionId')?.trim() ?? ''
  if (!conexionId) {
    return NextResponse.json({ error: 'Falta la conexión.' }, { status: 400 })
  }

  const res = await iniciarOauth({
    companyId: user.metadata.companyId,
    conexionId,
    conectorSlug: slug,
    config,
    redirectUri: redirectUriDeCallback(),
    iniciadoPor: user.metadata.dbUserId ?? null,
    volverA: destinoDeVueltaSeguro(req.nextUrl.searchParams.get('volverA')),
  })

  if (!res.ok) {
    const estado = res.motivo === 'conexion_no_existe' ? 404 : 503
    return NextResponse.json({ error: 'No se pudo iniciar la conexión.' }, { status: estado })
  }

  return NextResponse.redirect(res.url)
}
