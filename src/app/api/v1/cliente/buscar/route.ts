import { NextResponse } from 'next/server'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import { buscarUnificado, type BuscadorUnificadoResult } from '@/modules/cliente/actions'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

export async function GET(request: Request) {
  const user = await getApiClientUser(request)
  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: corsHeaders(request) })
  }

  try {
    const { searchParams } = new URL(request.url)
    const q = searchParams.get('q') ?? ''
    const cat = searchParams.get('cat') ?? ''
    const emp = searchParams.get('emp') ?? ''
    const fd = searchParams.get('fd') ?? ''
    const fh = searchParams.get('fh') ?? ''
    const stock = searchParams.get('stock') ?? ''

    const resultado = await buscarUnificado(q)
    if ('error' in resultado) {
      return NextResponse.json(
        { error: resultado.error },
        { status: 500, headers: corsHeaders(request) }
      )
    }

    // Mismos filtros que la página web /cliente/buscar (paridad BFF).
    const hoy = new Date()
    hoy.setHours(0, 0, 0, 0)
    const esExcursionVigente = (e: BuscadorUnificadoResult['excursiones'][number]) =>
      !e.todasFechasPasadas &&
      (!e.proximasSalidas ||
        e.proximasSalidas.length === 0 ||
        e.proximasSalidas.some((s) => !s.fechaPasada && new Date(s.fecha) >= hoy))

    let promociones = resultado.promociones
    let excursiones = resultado.excursiones.filter(esExcursionVigente)
    let empresas = resultado.empresas ?? []

    if (cat) {
      const catLower = cat.toLowerCase()
      excursiones = excursiones.filter((e) => e.categoria?.toLowerCase() === catLower)
      empresas = empresas.filter((emp) => emp.type?.toLowerCase() === catLower)
    }

    if (emp) {
      promociones = promociones.filter((p) => p.company?.id === emp)
      excursiones = excursiones.filter((e) => e.empresa?.id === emp)
      empresas = empresas.filter((e) => e.id === emp)
    }

    if (fd) {
      const fdDate = new Date(fd)
      excursiones = excursiones.filter((e) =>
        (e.proximasSalidas || []).some((s) => new Date(s.fecha) >= fdDate)
      )
    }

    if (fh) {
      const fhDate = new Date(fh)
      excursiones = excursiones.filter((e) =>
        (e.proximasSalidas || []).some((s) => new Date(s.fecha) <= fhDate)
      )
    }

    if (stock === '1') {
      excursiones = excursiones.filter(
        (e) =>
          (e.cupoDisponible == null || e.cupoDisponible > 0) &&
          !e.agotadaGlobal &&
          !e.todasFechasPasadas
      )
    }

    return NextResponse.json(
      { promociones, excursiones, empresas },
      { headers: corsHeaders(request) }
    )
  } catch (error) {
    console.error('[api/v1/cliente/buscar] Error en búsqueda unificada:', error)
    return NextResponse.json(
      { error: 'Error interno al buscar' },
      { status: 500, headers: corsHeaders(request) }
    )
  }
}