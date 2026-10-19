import { NextResponse, type NextRequest } from 'next/server'
import { requireSection } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { respuestaCsv } from '@/lib/csv'
import { conEmpresa } from '@/lib/tenant'
import { proveedoresDeLaEmpresaEnTx } from '@/modules/inventory/compras-queries'
import { sucursalesDeLaEmpresaEnTx } from '@/modules/inventory/queries'
import { leerFiltrosReposicion, type ParametrosUrl } from '@/modules/inventory/filtros'
import { reposicionEnTx } from '@/modules/inventory/reposicion-queries'
import { reposicionToCsv } from '@/modules/inventory/exportacion'

export const dynamic = 'force-dynamic'

/**
 * Exporta a CSV lo que hay que reponer, con LOS MISMOS filtros de la pantalla (`leerFiltrosReposicion` lee la URL igual que
 * ella): una fila por producto y sucursal con su proveedor, su cantidad sugerida y su último costo.
 *
 * Un route handler NO pasa por el layout de la sección, así que se guarda solo: sesión, rol, permisos por empleado y
 * capacidad con la función `comprar` (el archivo trae proveedores y costos de órdenes), y la empresa sale de la sesión,
 * jamás de la URL. Una sucursal o un proveedor de la URL que no son de la empresa simplemente no filtran.
 */
export async function GET(request: NextRequest) {
  const user = await requireSection('inventario', 'comprar')
  if (!user) return NextResponse.json({ error: 'No autorizado.' }, { status: 403 })
  const companyId = await resolveCompanyId(user)
  if (!companyId) return NextResponse.json({ error: 'Selecciona una empresa activa.' }, { status: 400 })

  const sp = request.nextUrl.searchParams
  const crudo: ParametrosUrl = {}
  for (const k of new Set(sp.keys())) crudo[k] = sp.get(k) ?? undefined

  try {
    const r = await conEmpresa(companyId, async (tx) => {
      const sucursales = await sucursalesDeLaEmpresaEnTx(tx, companyId)
      const { filas: proveedores } = await proveedoresDeLaEmpresaEnTx(tx, companyId, { incluirInactivos: true })
      const pedido = leerFiltrosReposicion(crudo)
      const sucursal = sucursales.find((s) => s.id === pedido.sucursalId)
      const proveedor = pedido.proveedorId === 'sin' ? null : proveedores.find((p) => p.id === pedido.proveedorId)
      const f = { ...pedido }
      if (!sucursal) delete f.sucursalId
      if (pedido.proveedorId !== 'sin' && !proveedor) delete f.proveedorId
      const datos = await reposicionEnTx(tx, companyId, f)
      const descripcion: Array<readonly [string, string]> = []
      if (sucursal) descripcion.push(['Sucursal', sucursal.nombre])
      if (f.proveedorId === 'sin') descripcion.push(['Proveedor', 'solo lo que no tiene proveedor'])
      else if (proveedor) descripcion.push(['Proveedor', proveedor.nombre])
      if (f.q) descripcion.push(['Producto', f.q])
      return { datos, descripcion }
    })
    return respuestaCsv(reposicionToCsv(r.datos.grupos, { alDia: r.datos.alDia, conObjetivo: r.datos.conObjetivo, truncado: r.datos.truncado, filtros: r.descripcion }), 'reposicion')
  } catch (e) {
    console.error('[admin-inventario-reposicion-exportar]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'No se pudo generar el archivo. Intenta de nuevo.' }, { status: 500 })
  }
}
