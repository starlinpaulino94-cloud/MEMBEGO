import { NextResponse } from 'next/server'
import { puedeFuncion, requireSection } from '@/lib/auth/guards'
import { respuestaCsv } from '@/lib/csv'
import { plantillaImportacionCsv } from '@/modules/inventory/importacion'

export const dynamic = 'force-dynamic'

/**
 * La plantilla del archivo de importación de existencias. Un route handler no
 * pasa por el layout de la sección: se guarda sola (`requireSection`). No lleva
 * datos de la empresa; se guarda igual porque la pantalla que la ofrece también lo está.
 */
export async function GET() {
  const user = await requireSection('inventario', 'ajustar')
  if (!user) return NextResponse.json({ error: 'No autorizado.' }, { status: 403 })
  // Quien puede registrar costos recibe la plantilla con la columna «costo»; los demás, sin ella.
  return respuestaCsv(plantillaImportacionCsv(await puedeFuncion('inventario', 'costos')), 'plantilla-entrada-inventario', { fechar: false })
}
