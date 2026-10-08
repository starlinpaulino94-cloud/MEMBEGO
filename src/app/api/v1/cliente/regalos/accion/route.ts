import { NextResponse } from 'next/server'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import { cancelarRegalo, responderRegalo } from '@/modules/regalos/actions'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

export async function POST(request: Request) {
  const user = await getApiClientUser(request)
  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: corsHeaders(request) })
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const regaloId = String(body.regaloId ?? '').trim()
  const decision = String(body.decision ?? '').trim()
  if (!regaloId || !['aceptar', 'rechazar', 'cancelar'].includes(decision)) {
    return NextResponse.json({ error: 'Acción de regalo inválida.' }, { status: 400, headers: corsHeaders(request) })
  }

  const formData = new FormData()
  formData.set('regaloId', regaloId)
  if (decision === 'aceptar' || decision === 'rechazar') {
    formData.set('decision', decision)
  }

  const result = decision === 'cancelar'
    ? await cancelarRegalo({}, formData, user)
    : await responderRegalo({}, formData, user)

  return NextResponse.json(
    result.success ? result : { error: result.error ?? 'No se pudo procesar el regalo.' },
    { status: result.success ? 200 : 400, headers: corsHeaders(request) },
  )
}
