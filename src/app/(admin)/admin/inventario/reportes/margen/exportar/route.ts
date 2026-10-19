import { NextResponse, type NextRequest } from 'next/server'
import { requireSection } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { respuestaCsv } from '@/lib/csv'
import { conEmpresa } from '@/lib/tenant'
import { zonaSegura } from '@/lib/zona-horaria'
import { sucursalesDeLaEmpresaEnTx } from '@/modules/inventory/queries'
import { leerFiltrosMargen, type ParametrosUrl } from '@/modules/inventory/filtros'
import { ETIQUETA_ORDEN_MARGEN, ORDEN_MARGEN_POR_DEFECTO } from '@/modules/inventory/margen'
import { TOPE_FILAS_MARGEN_CSV, margenEnTx } from '@/modules/inventory/margen-queries'
import { margenToCsv } from '@/modules/inventory/exportacion'

export const dynamic = 'force-dynamic'

/**
 * Exporta a CSV el margen real con LOS MISMOS filtros de la pantalla (`leerFiltrosMargen` lee la URL igual que ella): el resumen,
 * lo que no entra al margen y un renglón por producto, hasta `TOPE_FILAS_MARGEN_CSV` productos; si el tope corta la lista, el archivo
 * lo dice.
 *
 * Un route handler NO pasa por el layout de la sección: se guarda solo, y aquí con la función `costos`
 * (`requireSection('inventario', 'costos')`) porque un margen es costo contra precio: sin la función no hay archivo, ni siquiera
 * uno «sin costos». La empresa sale de la sesión, jamás de la URL. Una sucursal de la URL que no es de la empresa no filtra.
 */
export async function GET(request: NextRequest) {
  const user = await requireSection('inventario', 'costos')
  if (!user) return NextResponse.json({ error: 'No autorizado.' }, { status: 403 })
  const companyId = await resolveCompanyId(user)
  if (!companyId) return NextResponse.json({ error: 'Selecciona una empresa activa.' }, { status: 400 })

  const sp = request.nextUrl.searchParams
  const crudo: ParametrosUrl = {}
  for (const k of new Set(sp.keys())) crudo[k] = sp.get(k) ?? undefined

  try {
    const r = await conEmpresa(companyId, async (tx) => {
      const empresa = await tx.company.findUnique({ where: { id: companyId }, select: { zonaHoraria: true } })
      const zona = zonaSegura(empresa?.zonaHoraria)
      const sucursales = await sucursalesDeLaEmpresaEnTx(tx, companyId)
      const pedido = leerFiltrosMargen(crudo)
      const sucursal = sucursales.find((s) => s.id === pedido.sucursalId)
      const f = { ...pedido }
      if (!sucursal) delete f.sucursalId
      const vista = await margenEnTx(tx, companyId, f, { zonaHoraria: zona, todas: true })
      const descripcion: Array<readonly [string, string]> = []
      if (sucursal) descripcion.push(['Sucursal', sucursal.nombre])
      if (f.q) descripcion.push(['Producto', f.q])
      if (f.orden !== ORDEN_MARGEN_POR_DEFECTO) descripcion.push(['Orden', ETIQUETA_ORDEN_MARGEN[f.orden]])
      return { zona, vista, descripcion }
    })
    const csv = margenToCsv(r.vista, { zonaHoraria: r.zona, generadoEn: new Date(), filtros: r.descripcion, tope: TOPE_FILAS_MARGEN_CSV })
    return respuestaCsv(csv, `margen-real-${r.vista.desde}-a-${r.vista.hasta}`)
  } catch (e) {
    console.error('[admin-inventario-margen-exportar]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'No se pudo generar el archivo. Intenta de nuevo.' }, { status: 500 })
  }
}
