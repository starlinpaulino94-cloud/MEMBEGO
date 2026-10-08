import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { corsHeaders, getApiClientUser, handleCorsPreflight } from '@/lib/auth/api-guard'
import { conEmpresa } from '@/lib/tenant'
import { getCompanyPublic } from '@/modules/marketplace/cached'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const user = await getApiClientUser(request)
  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: corsHeaders(request) })
  }

  try {
    const { slug } = await params
    const company = await getCompanyPublic(slug)
    if (!company) {
      return NextResponse.json({ error: 'No encontrada' }, { status: 404, headers: corsHeaders(request) })
    }

    const body = await request.json().catch(() => null) as { rating?: unknown; comment?: unknown } | null
    const rating = Number(body?.rating)
    const comment = typeof body?.comment === 'string' ? body.comment.trim().slice(0, 600) : ''
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return NextResponse.json(
        { error: 'Elige una calificación de 1 a 5 estrellas.' },
        { status: 400, headers: corsHeaders(request) }
      )
    }

    const guardado = await conEmpresa(company.id, async (tx) => {
      const cliente = await tx.cliente.findUnique({
        where: { supabaseId_companyId: { supabaseId: user.supabaseId, companyId: company.id } },
        select: { id: true },
      })
      if (!cliente) return false

      await tx.companyRating.upsert({
        where: { companyId_clienteId: { companyId: company.id, clienteId: cliente.id } },
        create: { companyId: company.id, clienteId: cliente.id, rating, comment: comment || null },
        update: { rating, comment: comment || null },
      })

      const agg = await tx.companyRating.aggregate({
        where: { companyId: company.id, visible: true },
        _avg: { rating: true },
      })
      await tx.company.update({
        where: { id: company.id },
        data: { averageRating: agg._avg.rating },
      })
      return true
    })

    if (!guardado) {
      return NextResponse.json(
        { error: 'Únete a esta empresa para dejar tu reseña.' },
        { status: 403, headers: corsHeaders(request) }
      )
    }

    revalidatePath(`/cliente/empresas/${slug}`)
    revalidatePath(`/empresas/${slug}`)
    return NextResponse.json({ success: true }, { headers: corsHeaders(request) })
  } catch (error) {
    console.error('[api/v1/cliente/empresas] Error guardando reseña:', error)
    return NextResponse.json(
      { error: 'No se pudo guardar tu reseña. Intenta de nuevo.' },
      { status: 500, headers: corsHeaders(request) }
    )
  }
}
