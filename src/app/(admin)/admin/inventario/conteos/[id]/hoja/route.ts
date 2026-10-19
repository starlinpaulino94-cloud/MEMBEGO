import { NextResponse, type NextRequest } from 'next/server'
import { requireSection } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { respuestaCsv } from '@/lib/csv'
import { conEmpresa } from '@/lib/tenant'
import { conteoDetalleEnTx, hojaDeConteoEnTx } from '@/modules/inventory/queries'
import { hojaDeConteoToCsv } from '@/modules/inventory/exportacion'

export const dynamic = 'force-dynamic'

/**
 * Descarga la HOJA DE CONTEO EN BLANCO de la sucursal de un conteo abierto: qué
 * productos tienen existencias, SIN decir cuántas (conteo a ciegas), con una
 * columna «contado» vacía para llenar en papel o en Excel y subir de vuelta.
 *
 * Un route handler NO pasa por el layout de la sección, así que se guarda solo:
 * sesión, rol, permisos por empleado y capacidad (`requireSection('inventario',
 * 'ajustar')` — contar es el paso previo de un ajuste), y la empresa sale de la
 * sesión, jamás de la URL. Un conteo ajeno o inventado responde igual: 404.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireSection('inventario', 'ajustar')
  if (!user) return NextResponse.json({ error: 'No autorizado.' }, { status: 403 })
  const companyId = await resolveCompanyId(user)
  if (!companyId) return NextResponse.json({ error: 'Selecciona una empresa activa.' }, { status: 400 })
  const { id } = await params
  try {
    const r = await conEmpresa(companyId, async (tx) => {
      // `conEsperado: false`: ni siquiera se lee lo que decía el sistema.
      const conteo = await conteoDetalleEnTx(tx, companyId, id, { conEsperado: false })
      if (!conteo) return null
      return { conteo, hoja: await hojaDeConteoEnTx(tx, companyId, conteo.sucursalId) }
    })
    if (!r) return NextResponse.json({ error: 'Ese conteo no existe.' }, { status: 404 })
    return respuestaCsv(hojaDeConteoToCsv(r.hoja.filas), `hoja-de-conteo-${r.conteo.numero}`, { fechar: false })
  } catch (e) {
    console.error('[admin-inventario-conteo-hoja]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'No se pudo generar el archivo. Intenta de nuevo.' }, { status: 500 })
  }
}
