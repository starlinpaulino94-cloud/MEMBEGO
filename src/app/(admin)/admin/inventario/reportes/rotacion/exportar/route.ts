import { NextResponse, type NextRequest } from 'next/server'
import { puedeFuncion, requireSection } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { respuestaCsv } from '@/lib/csv'
import { conEmpresa } from '@/lib/tenant'
import { zonaSegura } from '@/lib/zona-horaria'
import { sucursalesDeLaEmpresaEnTx } from '@/modules/inventory/queries'
import { leerFiltrosRotacion, type ParametrosUrl } from '@/modules/inventory/filtros'
import { ETIQUETA_ESTADO_COBERTURA } from '@/modules/inventory/reportes'
import { TOPE_FILAS_ROTACION_CSV, rotacionEnTx } from '@/modules/inventory/reportes-queries'
import { rotacionToCsv } from '@/modules/inventory/exportacion'

export const dynamic = 'force-dynamic'

/**
 * Exporta a CSV la rotación y la cobertura con LOS MISMOS filtros de la pantalla (`leerFiltrosRotacion` lee la URL igual que
 * ella), todos los productos hasta `TOPE_FILAS_ROTACION_CSV`; si algún tope corta la lista, el archivo lo dice.
 *
 * Un route handler NO pasa por el layout de la sección: se guarda solo (sesión, rol, permisos por empleado y capacidad con
 * `requireSection('inventario')`) y la empresa sale de la sesión, jamás de la URL. El costo de ventas, el valor del inventario y
 * los días de inventario existen solo para quien tiene la función `costos`: sin ella ni siquiera se leen.
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
      const pedido = leerFiltrosRotacion(crudo)
      const sucursal = sucursales.find((s) => s.id === pedido.sucursalId)
      const f = { ...pedido }
      if (!sucursal) delete f.sucursalId
      const vista = await rotacionEnTx(tx, companyId, f, { conCostos, todas: true })
      const descripcion: Array<readonly [string, string]> = []
      if (sucursal) descripcion.push(['Sucursal', sucursal.nombre])
      if (f.q) descripcion.push(['Producto', f.q])
      if (f.estado) descripcion.push(['Estado', ETIQUETA_ESTADO_COBERTURA[f.estado]])
      return { zona, vista, descripcion }
    })
    const csv = rotacionToCsv(r.vista, { zonaHoraria: r.zona, generadoEn: new Date(), filtros: r.descripcion, tope: TOPE_FILAS_ROTACION_CSV })
    return respuestaCsv(csv, `rotacion-${r.vista.dias}-dias`)
  } catch (e) {
    console.error('[admin-inventario-rotacion-exportar]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'No se pudo generar el archivo. Intenta de nuevo.' }, { status: 500 })
  }
}
