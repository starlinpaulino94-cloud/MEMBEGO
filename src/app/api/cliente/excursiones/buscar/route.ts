import { NextResponse } from 'next/server'
import { buscarExcursionesPublicas } from '@/modules/excursiones/catalogo/search-queries'

export const dynamic = 'force-dynamic'
export const revalidate = 60

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    
    const filtros = {
      query: searchParams.get('q') ?? undefined,
      categoria: searchParams.get('cat') ?? undefined,
      empresa: searchParams.get('emp') ?? undefined,
      fechaDesde: searchParams.get('fd') ? new Date(searchParams.get('fd')!) : undefined,
      fechaHasta: searchParams.get('fh') ? new Date(searchParams.get('fh')!) : undefined,
      soloConStock: searchParams.get('stock') === '1',
      excluirFinalizadas: true,
      pagina: parseInt(searchParams.get('p') ?? '1', 10),
      porPagina: 12,
    }

    const resultado = await buscarExcursionesPublicas(filtros)

    return NextResponse.json(resultado)
  } catch (e) {
    console.error('[API] Error buscando excursiones:', e)
    return NextResponse.json(
      { error: 'Error al buscar excursiones' },
      { status: 500 }
    )
  }
}