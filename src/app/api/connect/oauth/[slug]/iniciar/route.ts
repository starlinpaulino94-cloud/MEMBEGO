import { NextResponse, type NextRequest } from 'next/server'
import { requireSection } from '@/lib/auth/guards'
import { iniciarOauth } from '@/modules/connect/oauth'
import { asegurarConexion } from '@/modules/connect/registro'
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
    // El proveedor no existe, no es de OAuth, o su app no está dada de alta en
    // este despliegue. Se dice, en vez de mandar al usuario a una pantalla de
    // consentimiento rota.
    return NextResponse.json(
      { error: 'Esa aplicación todavía no está disponible.' },
      { status: 404 }
    )
  }

  // La fila tiene que existir antes de salir hacia el proveedor: el `state`
  // firmado se ata a ella. Si quien llama no trae una, se resuelve o se crea
  // aquí — exigirla al navegador convertía este botón en un 400.
  const pedida = req.nextUrl.searchParams.get('conexionId')?.trim()
  const conexionId =
    pedida ||
    (await asegurarConexion({
      companyId: user.metadata.companyId,
      conectorSlug: slug,
      creadoPor: user.metadata.dbUserId ?? undefined,
    }))
  if (!conexionId) {
    return NextResponse.json({ error: 'No se pudo preparar la conexión.' }, { status: 409 })
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
    // El motivo real va al log del servidor: la pantalla no puede arreglarlo,
    // y un 503 mudo obligaba a adivinar si faltaba la fila o la firma.
    console.error('[connect] no se pudo iniciar OAuth:', { slug, motivo: res.motivo })
    if (res.motivo === 'conexion_no_existe') {
      return NextResponse.json({ error: 'No se pudo iniciar la conexión.' }, { status: 404 })
    }
    // `sin_secreto_firma`: es un fallo de ESTE despliegue, no de la empresa ni
    // de Google. Se dice con nombre para que quien administre la plataforma
    // sepa qué poner; el catálogo ya no ofrece el conector en este estado.
    return NextResponse.json(
      {
        error:
          'La plataforma no tiene configurada la firma de conexiones (PLATFORM_TOKEN_SECRET). Avisa al administrador de MembeGo.',
      },
      { status: 503 }
    )
  }

  return NextResponse.redirect(res.url)
}
