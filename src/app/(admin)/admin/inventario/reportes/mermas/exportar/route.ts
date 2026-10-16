import { NextResponse, type NextRequest } from 'next/server'
import { puedeFuncion, requireSection } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { respuestaCsv } from '@/lib/csv'
import { conEmpresa } from '@/lib/tenant'
import { zonaSegura } from '@/lib/zona-horaria'
import { sucursalesDeLaEmpresaEnTx } from '@/modules/inventory/queries'
import { leerFiltrosMermas, type ParametrosUrl } from '@/modules/inventory/filtros'
import { FILTRO_SIN_MOTIVO } from '@/modules/inventory/mermas'
import { TOPE_FILAS_MERMAS_CSV, mermasEnTx } from '@/modules/inventory/mermas-queries'
import { etiquetaDeMotivo, SIN_MOTIVO_CODIFICADO } from '@/modules/inventory/motivos'
import { mermasToCsv } from '@/modules/inventory/exportacion'

export const dynamic = 'force-dynamic'

/**
 * Exporta a CSV las mermas por motivo con LOS MISMOS filtros de la pantalla (`leerFiltrosMermas` lee la URL igual que ella): el
 * resumen, cada grupo por motivo y el detalle, hasta `TOPE_FILAS_MERMAS_CSV` movimientos; si el tope corta el detalle, el archivo
 * lo dice.
 *
 * Un route handler NO pasa por el layout de la sección: se guarda solo (sesión, rol, permisos por empleado y capacidad con
 * `requireSection('inventario')`) y la empresa sale de la sesión, jamás de la URL. El costo y el valor existen solo para quien
 * tiene la función `costos`: sin ella ni siquiera se leen. Una sucursal de la URL que no es de la empresa no filtra.
 */
export async function GET(request: NextRequest) {
  const user = await requireSection('inventario')
  if (!user) return NextResponse.json({ error: 'No autorizado.' }, { status: 403 })
  const companyId = await resolveCompanyId(user)
  if (!companyId) return NextResponse.json({ error: 'Selecciona una empresa activa.' }, { status: 400 })
  const conCostos = await puedeFuncion('inventario', 'costos')

  const sp = request.nextUrl.searchParams
  const crudo: ParametrosUrl = {}
  for (const k of new Set(sp.keys())) crudo[k] = sp.get(k) ?? undefined

  try {
    const r = await conEmpresa(companyId, async (tx) => {
      const empresa = await tx.company.findUnique({ where: { id: companyId }, select: { zonaHoraria: true } })
      const zona = zonaSegura(empresa?.zonaHoraria)
      const sucursales = await sucursalesDeLaEmpresaEnTx(tx, companyId)
      const pedido = leerFiltrosMermas(crudo)
      const sucursal = sucursales.find((s) => s.id === pedido.sucursalId)
      const f = { ...pedido }
      if (!sucursal) delete f.sucursalId
      const vista = await mermasEnTx(tx, companyId, f, { zonaHoraria: zona, conCostos, todas: true })
      const descripcion: Array<readonly [string, string]> = []
      if (sucursal) descripcion.push(['Sucursal', sucursal.nombre])
      if (f.motivo) descripcion.push(['Motivo', f.motivo === FILTRO_SIN_MOTIVO ? SIN_MOTIVO_CODIFICADO : etiquetaDeMotivo(f.motivo)])
      if (f.q) descripcion.push(['Producto', f.q])
      return { zona, vista, descripcion }
    })
    const csv = mermasToCsv(r.vista, { zonaHoraria: r.zona, generadoEn: new Date(), filtros: r.descripcion, tope: TOPE_FILAS_MERMAS_CSV })
    return respuestaCsv(csv, `mermas-por-motivo-${r.vista.desde}-a-${r.vista.hasta}`)
  } catch (e) {
    console.error('[admin-inventario-mermas-exportar]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'No se pudo generar el archivo. Intenta de nuevo.' }, { status: 500 })
  }
}
