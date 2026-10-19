import { NextResponse, type NextRequest } from 'next/server'
import { puedeFuncion, requireSection } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { respuestaCsv } from '@/lib/csv'
import { conEmpresa } from '@/lib/tenant'
import { zonaSegura } from '@/lib/zona-horaria'
import { sucursalesDeLaEmpresaEnTx } from '@/modules/inventory/queries'
import { leerFiltrosVencimientos, type ParametrosUrl } from '@/modules/inventory/filtros'
import { TOPE_FILAS_VENCIMIENTOS_CSV, vencimientosEnTx } from '@/modules/inventory/vencimientos-queries'
import { ETIQUETA_CLASE_VENCIMIENTO } from '@/modules/inventory/vencimientos'
import { vencimientosToCsv } from '@/modules/inventory/exportacion'

export const dynamic = 'force-dynamic'

/**
 * Exporta a CSV lo que vence pronto con LOS MISMOS filtros de la pantalla (`leerFiltrosVencimientos` lee la URL igual que ella), todos
 * los lotes hasta `TOPE_FILAS_VENCIMIENTOS_CSV`; si el tope corta la lista, el archivo lo dice.
 *
 * Un route handler NO pasa por el layout de la sección: se guarda solo (sesión, rol, permisos por empleado y capacidad con
 * `requireSection('inventario')`) y la empresa sale de la sesión, jamás de la URL. El costo y el valor existen solo para quien
 * tiene la función `costos`: sin ella ni siquiera se leen.
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
      const pedido = leerFiltrosVencimientos(crudo)
      const sucursal = sucursales.find((s) => s.id === pedido.sucursalId)
      const f = { ...pedido }
      if (!sucursal) delete f.sucursalId
      const vista = await vencimientosEnTx(tx, companyId, f, { zonaHoraria: zona, conCostos, todas: true })
      const descripcion: Array<readonly [string, string]> = []
      if (f.clase) descripcion.push(['Estado', ETIQUETA_CLASE_VENCIMIENTO[f.clase]])
      if (sucursal) descripcion.push(['Sucursal', sucursal.nombre])
      if (f.q) descripcion.push(['Producto o lote', f.q])
      return { zona, vista, descripcion }
    })
    const csv = vencimientosToCsv(r.vista, { zonaHoraria: r.zona, generadoEn: new Date(), filtros: r.descripcion, tope: TOPE_FILAS_VENCIMIENTOS_CSV })
    return respuestaCsv(csv, `vence-pronto-${r.vista.dias}-dias`)
  } catch (e) {
    console.error('[admin-inventario-vencimientos-exportar]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'No se pudo generar el archivo. Intenta de nuevo.' }, { status: 500 })
  }
}
