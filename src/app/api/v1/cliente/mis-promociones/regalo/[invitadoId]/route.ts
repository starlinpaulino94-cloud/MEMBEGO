import { NextResponse } from 'next/server'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { misClienteIds } from '@/modules/cliente/afiliacion'
import { inicioPeriodo, PERIODO_LABEL } from '@/modules/ofertas/periodo'
import { ofertaVigente } from '@/modules/ofertas/queries'
import { nuevoTokenQr, vencimientoQr } from '@/modules/qr/token'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

/**
 * BFF · Regalo VIP para la app RN.
 *
 * Espejo de `/cliente/mis-promociones/regalo/[invitadoId]` (web): el regalo
 * puede ser de cualquiera de sus empresas (pertenencia contra `misClienteIds`).
 * GET y POST hacen lo mismo: si el regalo está vigente, se completa el reclamo
 * pendiente y se genera el QR si falta (aprovisionamiento perezoso).
 */
async function cargarRegalo(user: NonNullable<Awaited<ReturnType<typeof getApiClientUser>>>, invitadoId: string) {
  const invitado = await sinEmpresa('regalo VIP: lookup por id (pertenencia validada abajo)', (tx) =>
    tx.ofertaInvitado.findUnique({
      where: { id: invitadoId },
      include: {
        oferta: { include: { company: { select: { name: true, zonaHoraria: true } } } },
        qrTokens: { where: { activo: true }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
    })
  )
  if (!invitado) return null

  const misIds = await misClienteIds(user.supabaseId)
  if (!misIds.includes(invitado.clienteId)) return null

  const oferta = invitado.oferta
  const vigente = oferta.estado === 'ACTIVA' && ofertaVigente(oferta)

  // Aprovisionamiento perezoso: reclamo pendiente se completa y el QR se
  // genera si falta. Nunca rompe la respuesta.
  let qr = invitado.qrTokens[0] ?? null
  if (vigente) {
    try {
      if (!invitado.reclamadaAt) {
        await conEmpresa(oferta.companyId, (tx) =>
          tx.ofertaInvitado.updateMany({
            where: { id: invitado.id, reclamadaAt: null },
            data: { reclamadaAt: new Date() },
          })
        )
      }
      if (!qr) {
        qr = await conEmpresa(oferta.companyId, (tx) =>
          tx.qrToken.create({
            data: {
              clienteId: invitado.clienteId,
              ofertaInvitadoId: invitado.id,
              token: nuevoTokenQr(),
              expiraAt: vencimientoQr(),
            },
          })
        )
      }
    } catch (e) {
      console.error('[regalo] aprovisionar QR:', e)
    }
  }

  const usados = await conEmpresa(oferta.companyId, (tx) =>
    tx.ofertaUso.count({
      where: {
        invitadoId: invitado.id,
        createdAt: { gte: inicioPeriodo(oferta.periodo, oferta.company.zonaHoraria) },
      },
    })
  ).catch(() => 0)
  const restantes = Math.max(0, oferta.usosPorPeriodo - usados)

  return {
    invitadoId: invitado.id,
    titulo: oferta.titulo,
    descripcion: oferta.descripcion,
    empresa: oferta.company.name,
    vigente,
    periodo: oferta.periodo,
    periodoLabel: PERIODO_LABEL[oferta.periodo],
    usosPorPeriodo: oferta.usosPorPeriodo,
    usosPeriodo: usados,
    restantes,
    vigenciaHasta: oferta.vigenciaHasta,
    qrToken: qr?.token ?? null,
    reclamadaAt: invitado.reclamadaAt,
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ invitadoId: string }> }
) {
  const user = await getApiClientUser(request)
  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: corsHeaders(request) })
  }

  try {
    const { invitadoId } = await params
    const regalo = await cargarRegalo(user, invitadoId)
    if (!regalo) {
      return NextResponse.json({ error: 'No encontrado' }, { status: 404, headers: corsHeaders(request) })
    }
    return NextResponse.json(regalo, { headers: corsHeaders(request) })
  } catch (error) {
    console.error('[api/v1/cliente/mis-promociones/regalo] Error cargando regalo:', error)
    return NextResponse.json(
      { error: 'Error interno al cargar el regalo' },
      { status: 500, headers: corsHeaders(request) }
    )
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ invitadoId: string }> }
) {
  const user = await getApiClientUser(request)
  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: corsHeaders(request) })
  }

  try {
    const { invitadoId } = await params
    const regalo = await cargarRegalo(user, invitadoId)
    if (!regalo) {
      return NextResponse.json({ error: 'No encontrado' }, { status: 404, headers: corsHeaders(request) })
    }
    return NextResponse.json(regalo, { headers: corsHeaders(request) })
  } catch (error) {
    console.error('[api/v1/cliente/mis-promociones/regalo] Error reclamando regalo:', error)
    return NextResponse.json(
      { error: 'Error interno al reclamar el regalo' },
      { status: 500, headers: corsHeaders(request) }
    )
  }
}