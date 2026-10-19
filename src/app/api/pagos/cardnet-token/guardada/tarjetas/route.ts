import { NextResponse, type NextRequest } from 'next/server'
import { getUser } from '@/lib/auth'
import { listarTarjetasCliente } from '@/modules/pagos/cardnetTokenGuardado'

export const dynamic = 'force-dynamic'

export async function GET(_request: NextRequest) {
  const user = await getUser()
  if (!user || user.metadata.role !== 'CLIENTE' || !user.metadata.clienteId || !user.metadata.companyId) {
    return NextResponse.json({ ok: false, error: 'No autorizado.' }, { status: 401 })
  }
  const tarjetas = await listarTarjetasCliente(user.metadata.clienteId, user.metadata.companyId)
  return NextResponse.json({ ok: true, tarjetas })
}
