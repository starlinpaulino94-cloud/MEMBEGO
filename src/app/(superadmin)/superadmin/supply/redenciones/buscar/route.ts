import { NextResponse, type NextRequest } from 'next/server'
import { requireRole } from '@/lib/auth/guards'
import { RUTA_REDENCIONES } from '@/modules/supply-v2/core/catalogo'
import { redencionPorCodigo } from '@/modules/supply-v2/redemption/queries'

/**
 * Buscador por código de la pantalla Redenciones: con el código exacto de la
 * redención (MBG-RED-…) o de la orden abre su ficha; si no lo encuentra, vuelve
 * al listado filtrado por ese texto. Solo consulta: no valida ni entrega nada.
 */
export async function GET(req: NextRequest) {
  await requireRole('SUPERADMIN')
  const codigo = (req.nextUrl.searchParams.get('codigo') ?? '').trim().slice(0, 80)
  const id = codigo ? await redencionPorCodigo(codigo) : null
  const destino = id ? `${RUTA_REDENCIONES}/${id}` : codigo ? `${RUTA_REDENCIONES}?q=${encodeURIComponent(codigo)}&noencontrado=1` : RUTA_REDENCIONES
  return NextResponse.redirect(new URL(destino, req.url))
}
