import { NextResponse, type NextRequest } from 'next/server'
import { requireSection } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { respuestaCsv } from '@/lib/csv'
import { conEmpresa } from '@/lib/tenant'
import { zonaSegura } from '@/lib/zona-horaria'
import { ordenDetalleEnTx } from '@/modules/inventory/compras-queries'
import { ordenToCsv } from '@/modules/inventory/exportacion'

export const dynamic = 'force-dynamic'

/**
 * Descarga en CSV UNA orden de compra: encabezado, resumen, líneas con su costo y cada entrada de mercancía que produjo.
 *
 * Un route handler NO pasa por el layout de la sección, así que se guarda solo: sesión, rol, permisos por empleado y
 * capacidad con la función `comprar` (el archivo trae los costos de la orden), y la empresa sale de la sesión, jamás de
 * la URL. Una orden ajena o inventada responde igual: 404.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireSection('inventario', 'comprar')
  if (!user) return NextResponse.json({ error: 'No autorizado.' }, { status: 403 })
  const companyId = await resolveCompanyId(user)
  if (!companyId) return NextResponse.json({ error: 'Selecciona una empresa activa.' }, { status: 400 })
  const { id } = await params
  try {
    const r = await conEmpresa(companyId, async (tx) => {
      const empresa = await tx.company.findUnique({ where: { id: companyId }, select: { zonaHoraria: true } })
      return { zona: zonaSegura(empresa?.zonaHoraria), orden: await ordenDetalleEnTx(tx, companyId, id) }
    })
    if (!r.orden) return NextResponse.json({ error: 'Esa orden no existe.' }, { status: 404 })
    return respuestaCsv(ordenToCsv(r.orden, r.zona), r.orden.numero, { fechar: false })
  } catch (e) {
    console.error('[admin-inventario-compra-exportar]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'No se pudo generar el archivo. Intenta de nuevo.' }, { status: 500 })
  }
}
