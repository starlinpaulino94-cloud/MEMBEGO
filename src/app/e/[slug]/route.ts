import { randomUUID } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { getAppUrl } from '@/lib/site'
import { esBotDeVistaPrevia } from '@/lib/share/bots'
import { VISITOR_COOKIE, VISITOR_COOKIE_DIAS } from '@/lib/referidos'
import {
  resolverEnlace,
  registrarVisita,
  ventanaDeEmpresa,
} from '@/modules/excursiones/atribucion/registrar'
import {
  VENDEDOR_COOKIE,
  sanitizarCanalAtribucion,
} from '@/modules/excursiones/atribucion/nucleo'

export const dynamic = 'force-dynamic'

/**
 * GET /e/[slug] — el enlace (y el QR) del vendedor.
 *
 * Hace tres cosas y ninguna más: cuenta la VISITA, se acuerda de quién trajo a
 * esta persona (cookie durante la ventana de atribución) y la manda al
 * registro de la empresa. El `?v=` del destino es informativo; lo que atribuye
 * de verdad es la cookie, que sobrevive a que el cliente se vaya y vuelva.
 *
 * Enlace apagado, vendedor no activo o empresa cerrada: al inicio, sin contar
 * nada y sin decir por qué (no se filtra información de otra empresa).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const base = getAppUrl()

  const enlace = await resolverEnlace(slug.trim().toLowerCase())
  if (!enlace) return NextResponse.redirect(base)

  const destino = `${base}/registro/${enlace.companySlug}?v=${encodeURIComponent(
    enlace.codigoVendedor
  )}&e=${encodeURIComponent(enlace.slug)}`

  // Los robots de vista previa (WhatsApp, Facebook…) abren el enlace antes que
  // la persona: si contaran, cada compartida sería una visita falsa.
  if (esBotDeVistaPrevia(req.headers.get('user-agent'))) {
    return NextResponse.redirect(destino)
  }

  const visitorId = req.cookies.get(VISITOR_COOKIE)?.value || randomUUID()
  const canal = sanitizarCanalAtribucion(req.nextUrl.searchParams.get('c'))

  await registrarVisita({
    enlace,
    visitorId,
    canal,
    landing: `/registro/${enlace.companySlug}`,
  })

  const ventanaDias = await ventanaDeEmpresa(enlace.companyId)
  const res = NextResponse.redirect(destino)
  res.cookies.set(VISITOR_COOKIE, visitorId, {
    maxAge: VISITOR_COOKIE_DIAS * 24 * 60 * 60,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  })
  res.cookies.set(VENDEDOR_COOKIE, enlace.slug, {
    maxAge: ventanaDias * 24 * 60 * 60,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  })
  return res
}
