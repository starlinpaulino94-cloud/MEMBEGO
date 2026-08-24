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

  // Los robots de vista previa (WhatsApp, Facebook…) abren el enlace antes que
  // la persona: si contaran, cada compartida sería una visita falsa.
  if (esBotDeVistaPrevia(req.headers.get('user-agent'))) {
    const destino = `${base}/registro/${enlace.companySlug}?v=${encodeURIComponent(
      enlace.codigoVendedor
    )}&e=${encodeURIComponent(enlace.slug)}&next=${encodeURIComponent(
      `/empresas/${enlace.companySlug}/excursiones`
    )}`
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

  // Obtener estado de sesión desde Auth
  const { getUser } = await import('@/lib/auth')
  const user = await getUser().catch(() => null)
  const isCliente = user && user.metadata.role === 'CLIENTE'

  // Si está logueado, llevarlo al catálogo directo. Si no, al registro con next.
  const nextUrl = `/empresas/${enlace.companySlug}/excursiones`
  let destino: string
  
  if (isCliente) {
    destino = `${base}${nextUrl}?e=${encodeURIComponent(enlace.slug)}`
  } else {
    destino = `${base}/registro/${enlace.companySlug}?v=${encodeURIComponent(
      enlace.codigoVendedor
    )}&e=${encodeURIComponent(enlace.slug)}&next=${encodeURIComponent(nextUrl)}`
  }

  const res = NextResponse.redirect(destino)
  res.cookies.set({
    name: VISITOR_COOKIE,
    value: visitorId,
    maxAge: VISITOR_COOKIE_DIAS * 24 * 60 * 60,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  })

  const ventanaDias = await ventanaDeEmpresa(enlace.companyId)
  res.cookies.set({
    name: VENDEDOR_COOKIE,
    value: enlace.slug,
    maxAge: ventanaDias * 24 * 60 * 60,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  })

  return res
}
