import { NextResponse } from 'next/server'
import { buscarUnificado } from '@/modules/cliente/actions'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q') ?? ''

  if (!q.trim()) {
    return NextResponse.json({ promociones: [], excursiones: [] })
  }

  const resultado = await buscarUnificado(q)

  if ('error' in resultado) {
    return NextResponse.json({ error: resultado.error }, { status: 500 })
  }

  return NextResponse.json(resultado)
}