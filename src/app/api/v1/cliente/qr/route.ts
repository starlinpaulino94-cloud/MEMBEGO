import { NextResponse } from 'next/server'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import { conEmpresa } from '@/lib/tenant'
import { getClienteAllMemberships } from '@/modules/cliente/queries'
import { getFeaturedPromotions, getCompanyStats } from '@/modules/marketplace/cached'
import { formatMoney } from '@/lib/format'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

function textoVencimiento(v: Date | null, estado: string): string | null {
  if (!v) return null
  const dias = Math.ceil((new Date(v).getTime() - Date.now()) / 86_400_000)
  if (dias < 0) return `Venció el ${new Date(v).toLocaleDateString('es-DO')}`
  if (estado !== 'ACTIVA') return null
  if (dias === 0) return 'Vence hoy'
  return `Vence en ${dias} día${dias !== 1 ? 's' : ''}`
}

export async function GET(request: Request) {
  const user = await getApiClientUser(request)
  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: corsHeaders(request) })
  }

  try {
    const { searchParams } = new URL(request.url)
    const pedida = (searchParams.get('id') ?? '').trim()

    const memberships = await getClienteAllMemberships(
      user.supabaseId,
      user.metadata.clienteId
    ).catch(() => [])

    const activas = memberships.filter((m) => m.estado === 'ACTIVA')
    const elegida =
      memberships.find((m) => m.id === pedida) ??
      activas.find((m) => m.qrToken) ??
      activas[0] ??
      null
    const membresias = memberships.map((m) => ({
      id: m.id,
      companyName: m.company.name,
      planNombre: m.plan.nombre,
      estado: m.estado,
      fechaVencimiento: m.fechaVencimiento,
    }))

    const ahora = new Date()
    const usable =
      elegida &&
      elegida.estado === 'ACTIVA' &&
      elegida.qrToken &&
      (!elegida.fechaVencimiento || new Date(elegida.fechaVencimiento) > ahora)
        ? elegida
        : null

    if (!usable) {
      const [destacadas, empresa, ubicacion] = await Promise.all([
        getFeaturedPromotions(4).catch(() => []),
        user.metadata.clienteId && user.metadata.companyId
          ? conEmpresa(user.metadata.companyId, (tx) =>
              tx.company.findUnique({
                where: { id: user.metadata.companyId! },
                select: { bienvenidaActiva: true, bienvenidaTipo: true, bienvenidaValor: true },
              })
            ).catch(() => null)
          : Promise.resolve(null),
        user.metadata.dbUserId
          ? import('@/modules/geo/ubicaciones/service')
              .then((m) => m.LocationService.primaria(user.metadata.dbUserId!))
              .catch(() => null)
          : Promise.resolve(null),
      ])

      const primeras = destacadas.slice(0, 4)
      const stats = await Promise.all(
        primeras.map((p) =>
          getCompanyStats(p.company.slug)
            .then((s) => ({ id: p.id, rating: s?.averageRating ?? null, n: s?.totalRatings ?? 0 }))
            .catch(() => ({ id: p.id, rating: null as number | null, n: 0 }))
        )
      )
      const porPromo = new Map(stats.map((s) => [s.id, s]))
      const tarjetas = primeras.map((promo) => ({
        promo,
        valoracion: porPromo.get(promo.id)?.rating ?? null,
        resenas: porPromo.get(promo.id)?.n ?? 0,
      }))

      const ofreceBienvenida = !!empresa?.bienvenidaActiva && memberships.length === 0
      const bienvenida = !ofreceBienvenida
        ? null
        : empresa?.bienvenidaTipo === 'MONTO' && empresa.bienvenidaValor != null
          ? `Bono de bienvenida de ${formatMoney(Number(empresa.bienvenidaValor))} con tu primera membresía registrada`
          : 'Beneficio de bienvenida con tu primera membresía registrada'

      return NextResponse.json({
        usable: null,
        memberships: membresias,
        sinBeneficio: {
          destacadas: tarjetas,
          bienvenida,
          ciudad: ubicacion?.sector?.name ?? ubicacion?.city?.name ?? null,
        },
      }, { headers: corsHeaders(request) })
    }

    const vencimiento = textoVencimiento(usable.fechaVencimiento, usable.estado)
    const usos = usable.plan.esIlimitado
      ? 'Ilimitado'
      : `${usable.lavadosRestantes} de ${usable.plan.lavadosIncluidos ?? '—'} usos`

    return NextResponse.json({
      usable: {
        id: usable.id,
        token: usable.qrToken?.token ?? '',
        planNombre: usable.plan.nombre,
        companyName: usable.company.name,
        companySlug: usable.company.slug,
        estado: usable.estado,
        usos,
        vencimiento,
        fechaVencimiento: usable.fechaVencimiento,
      },
      memberships: membresias,
      sinBeneficio: null,
    }, { headers: corsHeaders(request) })
  } catch (error) {
    console.error('[api/v1/cliente/qr] Error procesando QR de cliente:', error)
    return NextResponse.json(
      { error: 'Error interno al cargar código QR' },
      { status: 500, headers: corsHeaders(request) }
    )
  }
}
