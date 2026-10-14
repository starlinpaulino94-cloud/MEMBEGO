import { NextResponse, type NextRequest } from 'next/server'
import { requireSection } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { respuestaCsv } from '@/lib/csv'
import { conEmpresa } from '@/lib/tenant'
import { zonaSegura } from '@/lib/zona-horaria'
import { conteoDetalleEnTx } from '@/modules/inventory/queries'
import { conteoToCsv } from '@/modules/inventory/exportacion'

export const dynamic = 'force-dynamic'

/**
 * Descarga el INFORME DE DIFERENCIAS de un conteo (esperado, contado y diferencia
 * por producto). Lleva lo que decía el sistema, así que NO se ofrece mientras se
 * cuenta a ciegas desde la pantalla de captura; sí está en la revisión y en el
 * conteo ya cerrado.
 *
 * Un route handler NO pasa por el layout de la sección, así que se guarda solo:
 * sesión, rol, permisos por empleado y capacidad (`requireSection('inventario')`),
 * y la empresa sale de la sesión, jamás de la URL. Un conteo ajeno o inventado
 * responde igual: 404.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireSection('inventario')
  if (!user) return NextResponse.json({ error: 'No autorizado.' }, { status: 403 })
  const companyId = await resolveCompanyId(user)
  if (!companyId) return NextResponse.json({ error: 'Selecciona una empresa activa.' }, { status: 400 })
  const { id } = await params
  try {
    const r = await conEmpresa(companyId, async (tx) => {
      const empresa = await tx.company.findUnique({ where: { id: companyId }, select: { zonaHoraria: true } })
      return { zona: zonaSegura(empresa?.zonaHoraria), conteo: await conteoDetalleEnTx(tx, companyId, id, { conEsperado: true }) }
    })
    if (!r.conteo) return NextResponse.json({ error: 'Ese conteo no existe.' }, { status: 404 })
    return respuestaCsv(conteoToCsv({ ...r.conteo }, r.zona), `diferencias-${r.conteo.numero}`, { fechar: false })
  } catch (e) {
    console.error('[admin-inventario-conteo-exportar]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'No se pudo generar el archivo. Intenta de nuevo.' }, { status: 500 })
  }
}
