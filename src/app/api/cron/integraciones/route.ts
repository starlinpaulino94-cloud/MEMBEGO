import { NextResponse, type NextRequest } from 'next/server'
import { autorizarCron } from '@/lib/cron-auth'
import { reintentarPendientes } from '@/modules/integraciones/despacho'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * CRON: reintenta los webhooks pendientes hacia los sistemas satélite (el
 * outbox garantiza que un satélite caído no pierde eventos — se reintentan
 * hasta 8 veces y luego quedan FALLIDO para revisión).
 */
export async function GET(req: NextRequest) {
  const denegado = autorizarCron(req)
  if (denegado) return denegado
  const resultado = await reintentarPendientes()
  return NextResponse.json({ ok: true, ...resultado })
}
