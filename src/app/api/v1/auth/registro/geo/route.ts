import { NextResponse } from 'next/server'
import { z } from 'zod'
import { handleMobileCorsPreflight, mobileCorsHeaders } from '@/lib/auth/mobile-cors'
import {
  listarPaisesOperativos,
  listarRegionesDePais,
  listarCiudadesDeRegion,
  listarSectoresDeCiudad,
} from '@/modules/geo/catalogo/actions'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleMobileCorsPreflight(request)
}

const querySchema = z.object({
  step: z.enum(['country', 'region', 'city', 'sector']),
  parentId: z.string().trim().optional(),
})

export async function GET(request: Request) {
  const url = new URL(request.url)
  const parsed = querySchema.safeParse({ step: url.searchParams.get('step'), parentId: url.searchParams.get('parentId') ?? undefined })
  if (!parsed.success) return NextResponse.json({ error: 'Catálogo inválido.' }, { status: 400, headers: mobileCorsHeaders(request) })

  const { step, parentId } = parsed.data
  const options = step === 'country'
    ? await listarPaisesOperativos()
    : step === 'region'
      ? await listarRegionesDePais(parentId ?? '')
      : step === 'city'
        ? await listarCiudadesDeRegion(parentId ?? '')
        : await listarSectoresDeCiudad(parentId ?? '')
  return NextResponse.json({ options }, { headers: mobileCorsHeaders(request) })
}
