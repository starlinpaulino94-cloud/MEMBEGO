import { NextResponse, type NextRequest } from 'next/server'
import { requireSection } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { respuestaCsv } from '@/lib/csv'
import { conEmpresa } from '@/lib/tenant'
import { zonaSegura } from '@/lib/zona-horaria'
import { sucursalesDeLaEmpresaEnTx } from '@/modules/inventory/queries'
import { leerFiltrosValor, type ParametrosUrl } from '@/modules/inventory/filtros'
import { TOPE_FILAS_VALOR, valorDelInventarioEnTx } from '@/modules/inventory/valor'
import { valorToCsv } from '@/modules/inventory/exportacion'

export const dynamic = 'force-dynamic'

/**
 * Exporta a CSV el valor del inventario con LOS MISMOS filtros de la pantalla (`leerFiltrosValor` lee la URL igual que
 * ella), hasta `TOPE_FILAS_VALOR` productos. Si el tope corta el resultado, el archivo lo dice.
 *
 * Un route handler NO pasa por el layout de la sección, así que se guarda solo: sesión, rol, permisos por empleado,
 * capacidad y la función `costos` (`requireSection('inventario', 'costos')`) —el valor del inventario es información de
 * costos—. La empresa sale de la sesión, jamás de la URL.
 */
export async function GET(request: NextRequest) {
  const user = await requireSection('inventario', 'costos')
  if (!user) return NextResponse.json({ error: 'No autorizado.' }, { status: 403 })
  const companyId = await resolveCompanyId(user)
  if (!companyId) return NextResponse.json({ error: 'Selecciona una empresa activa.' }, { status: 400 })

  // El primer valor de cada parámetro, igual que la pantalla.
  const sp = request.nextUrl.searchParams
  const crudo: ParametrosUrl = {}
  for (const k of new Set(sp.keys())) crudo[k] = sp.get(k) ?? undefined

  try {
    const r = await conEmpresa(companyId, async (tx) => {
      const empresa = await tx.company.findUnique({ where: { id: companyId }, select: { zonaHoraria: true } })
      const zona = zonaSegura(empresa?.zonaHoraria)
      const sucursales = await sucursalesDeLaEmpresaEnTx(tx, companyId)
      const pedido = leerFiltrosValor(crudo)
      const sucursal = sucursales.find((s) => s.id === pedido.sucursalId)
      const f = { ...pedido }
      if (!sucursal) delete f.sucursalId
      const valor = await valorDelInventarioEnTx(tx, companyId, f, { zonaHoraria: zona, todas: true })
      const descripcion: Array<readonly [string, string]> = []
      if (sucursal) descripcion.push(['Sucursal', sucursal.nombre])
      if (f.q) descripcion.push(['Producto', f.q])
      if (f.sinCosto) descripcion.push(['Solo', 'productos sin costo'])
      return { zona, valor, descripcion }
    })
    return respuestaCsv(valorToCsv(r.valor, { zonaHoraria: r.zona, generadoEn: new Date(), filtros: r.descripcion, tope: TOPE_FILAS_VALOR }), 'valor-del-inventario')
  } catch (e) {
    console.error('[admin-inventario-valor-exportar]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'No se pudo generar el archivo. Intenta de nuevo.' }, { status: 500 })
  }
}
