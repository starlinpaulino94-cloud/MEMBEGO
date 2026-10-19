import { NextResponse, type NextRequest } from 'next/server'
import { puedeFuncion, requireSection } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { respuestaCsv } from '@/lib/csv'
import { conEmpresa } from '@/lib/tenant'
import { zonaSegura } from '@/lib/zona-horaria'
import { entradaDetalleEnTx } from '@/modules/inventory/queries'
import { entradaToCsv } from '@/modules/inventory/exportacion'

export const dynamic = 'force-dynamic'

/**
 * Descarga en CSV UNA entrada de mercancía con todas sus líneas.
 *
 * Un route handler NO pasa por el layout de la sección, así que se guarda solo:
 * sesión, rol, permisos por empleado y capacidad (`requireSection('inventario')`),
 * y la empresa sale de la sesión, jamás de la URL. Una entrada ajena o inventada
 * responde igual: 404.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireSection('inventario')
  if (!user) return NextResponse.json({ error: 'No autorizado.' }, { status: 403 })
  const companyId = await resolveCompanyId(user)
  if (!companyId) return NextResponse.json({ error: 'Selecciona una empresa activa.' }, { status: 400 })
  const { id } = await params
  // Los costos van en el archivo solo si quien lo descarga puede verlos (función «costos»).
  const conCostos = await puedeFuncion('inventario', 'costos')
  try {
    const r = await conEmpresa(companyId, async (tx) => {
      const empresa = await tx.company.findUnique({ where: { id: companyId }, select: { zonaHoraria: true } })
      return { zona: zonaSegura(empresa?.zonaHoraria), entrada: await entradaDetalleEnTx(tx, companyId, id, { conCostos }) }
    })
    if (!r.entrada) return NextResponse.json({ error: 'Esa entrada no existe.' }, { status: 404 })
    return respuestaCsv(entradaToCsv(r.entrada, r.zona), r.entrada.numero, { fechar: false })
  } catch (e) {
    console.error('[admin-inventario-entrada-exportar]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'No se pudo generar el archivo. Intenta de nuevo.' }, { status: 500 })
  }
}
