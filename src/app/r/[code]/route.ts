import { randomUUID } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { sinEmpresa } from '@/lib/tenant'
import { getUser } from '@/lib/auth'
import { getAppUrl } from '@/lib/site'
import {
  logReferralEvent,
  hashIp,
  REF_COOKIE,
  REF_COOKIE_DIAS,
  VISITOR_COOKIE,
  VISITOR_COOKIE_DIAS,
} from '@/lib/referidos'
import { resolverGrowthLink } from '@/modules/growth/links'
import { createRateLimiter, getClientIdentifier } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

// Anti-abuso: máximo de clics contabilizados por IP para un mismo código.
// Los clics por encima del límite siguen redirigiendo, solo no suman puntos.
const clickLimiter = createRateLimiter({
  interval: 60 * 60 * 1000, // 1 hora
  maxRequests: 5,
})

const BOT_RE =
  /whatsapp|facebookexternalhit|telegrambot|twitterbot|slackbot|discordbot|linkedinbot|skypeuripreview|viber|pinterest|googlebot|bingbot|applebot|yandex|ahrefs|semrush|bot\b|crawler|spider|preview|fetch|monitor|curl|wget|python|node-fetch|axios|okhttp|java\/|headless/i

/**
 * GET /r/[code] — enlace inteligente de referidos.
 *
 * Growth Engine 3.0: si el código es un GrowthLink, redirige a la LANDING de
 * invitación (`/i/[code]`) en vez de al registro (venta del beneficio
 * primero). Si es el código legacy del cliente, mantiene el comportamiento
 * anterior (redirige al registro con ?ref). Ambos registran el clic.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params
  const base = getAppUrl()
  const clean = code.trim()

  const ip = getClientIdentifier(req)
  const ua = req.headers.get('user-agent') ?? ''
  const esBot = BOT_RE.test(ua)
  const canal = req.nextUrl.searchParams.get('c')
  const campana = req.nextUrl.searchParams.get('utm_campaign')
  const dispositivo = /mobile|android|iphone|ipad/i.test(ua) ? 'móvil' : 'escritorio'
  const visitorId = req.cookies.get(VISITOR_COOKIE)?.value || randomUUID()

  // ── Growth Engine 3.0: enlace de invitación con landing propia ──────────────
  const growth = await resolverGrowthLink(clean).catch(() => null)
  if (growth) {
    // ¿El propio dueño abriendo su enlace? No cuenta.
    let esDuenno = false
    const tieneSesion = req.cookies
      .getAll()
      .some((c) => c.name.startsWith('sb-') && c.name.includes('auth-token'))
    if (tieneSesion) {
      const sessionUser = await getUser().catch(() => null)
      esDuenno = sessionUser?.metadata.clienteId === growth.clienteId
    }

    if (!esBot && !esDuenno && (await clickLimiter(`refclick:${ip}:${growth.id}`))) {
      await logReferralEvent({
        clienteId: growth.clienteId,
        companyId: growth.companyId,
        tipo: 'CLICK',
        canal,
        visitorId,
        growthLinkId: growth.id,
        meta: { dispositivo, ipHash: hashIp(ip), ...(campana ? { campana } : {}) },
      })
    }

    const res = NextResponse.redirect(`${base}/i/${growth.code}`)
    if (!esDuenno) {
      res.cookies.set(VISITOR_COOKIE, visitorId, {
        maxAge: VISITOR_COOKIE_DIAS * 24 * 60 * 60,
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
      })
    }
    return res
  }

  // ── Legacy: código único del cliente → registro directo (sin romper nada) ───
  const cliente = await sinEmpresa('referral-link-lookup', (tx) =>
    tx.cliente.findFirst({
      where: {
        OR: [{ codigoCorto: clean.toUpperCase() }, { codigoReferido: clean }],
      },
      select: {
        id: true,
        codigoReferido: true,
        companyId: true,
        company: { select: { slug: true, isActive: true } },
      },
    })
  ).catch(() => null)

  // Código inválido o empresa inactiva: al marketplace, sin tracking.
  if (!cliente || !cliente.company.isActive) {
    return NextResponse.redirect(`${base}/empresas`)
  }

  // Autoclic: el propio referente abriendo su enlace no cuenta.
  let esDuenno = false
  const tieneSesion = req.cookies
    .getAll()
    .some((c) => c.name.startsWith('sb-') && c.name.includes('auth-token'))
  if (tieneSesion) {
    const sessionUser = await getUser().catch(() => null)
    esDuenno = sessionUser?.metadata.clienteId === cliente.id
  }

  if (!esBot && !esDuenno && (await clickLimiter(`refclick:${ip}:${cliente.id}`))) {
    await logReferralEvent({
      clienteId: cliente.id,
      companyId: cliente.companyId,
      tipo: 'CLICK',
      canal,
      visitorId,
      meta: { dispositivo, ipHash: hashIp(ip), ...(campana ? { campana } : {}) },
    })
  }

  const res = NextResponse.redirect(
    `${base}/registro/${cliente.company.slug}?ref=${cliente.codigoReferido}`
  )
  if (!esDuenno) {
    res.cookies.set(VISITOR_COOKIE, visitorId, {
      maxAge: VISITOR_COOKIE_DIAS * 24 * 60 * 60,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    })
    res.cookies.set(REF_COOKIE, cliente.codigoReferido, {
      maxAge: REF_COOKIE_DIAS * 24 * 60 * 60,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    })
  }
  return res
}
