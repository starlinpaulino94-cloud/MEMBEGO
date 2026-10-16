import { NextResponse, type NextRequest } from 'next/server'
import { puedeFuncion, requireSection } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { respuestaCsv } from '@/lib/csv'
import { conEmpresa } from '@/lib/tenant'
import { zonaSegura } from '@/lib/zona-horaria'
import { sucursalesDeLaEmpresaEnTx } from '@/modules/inventory/queries'
import { leerFiltrosKardex, type ParametrosUrl } from '@/modules/inventory/filtros'
import { TOPE_FILAS_KARDEX_CSV, kardexEnTx } from '@/modules/inventory/reportes-queries'
import { kardexToCsv } from '@/modules/inventory/exportacion'

export const dynamic = 'force-dynamic'

/**
 * Exporta a CSV el kardex de UN producto con LOS MISMOS filtros de la pantalla (`leerFiltrosKardex` lee la URL igual que ella),
 * hasta `TOPE_FILAS_KARDEX_CSV` movimientos; si el tope corta el periodo, el archivo lo dice.
 *
 * Un route handler NO pasa por el layout de la sección, así que se guarda solo: sesión, rol, permisos por empleado y capacidad
 * (`requireSection('inventario')`), y la empresa sale de la sesión, jamás de la URL. Las columnas de costo existen solo para
 * quien tiene la función `costos`: sin ella ni siquiera se leen. Una sucursal de la URL que no es de la empresa no filtra, y un
 * producto que no es de la empresa responde 404.
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
  const pedido = leerFiltrosKardex(crudo)
  if (!pedido.varianteId) return NextResponse.json({ error: 'Falta el producto del kardex.' }, { status: 400 })
  const varianteId = pedido.varianteId

  try {
    const r = await conEmpresa(companyId, async (tx) => {
      const empresa = await tx.company.findUnique({ where: { id: companyId }, select: { zonaHoraria: true } })
      const zona = zonaSegura(empresa?.zonaHoraria)
      const sucursales = await sucursalesDeLaEmpresaEnTx(tx, companyId)
      const f = { ...pedido, varianteId }
      if (!sucursales.some((s) => s.id === f.sucursalId)) delete f.sucursalId
      const kardex = await kardexEnTx(tx, companyId, f, { zonaHoraria: zona, conCostos, limite: TOPE_FILAS_KARDEX_CSV })
      return { zona, kardex }
    })
    if (!r.kardex) return NextResponse.json({ error: 'Producto no encontrado.' }, { status: 404 })
    const csv = kardexToCsv(r.kardex, { zonaHoraria: r.zona, generadoEn: new Date(), tope: TOPE_FILAS_KARDEX_CSV })
    return respuestaCsv(csv, 'kardex')
  } catch (e) {
    console.error('[admin-inventario-kardex-exportar]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'No se pudo generar el archivo. Intenta de nuevo.' }, { status: 500 })
  }
}
