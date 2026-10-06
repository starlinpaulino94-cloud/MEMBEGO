import { NextResponse, type NextRequest } from 'next/server'
import { autorizarCron } from '@/lib/cron-auth'
import { barridoPedidos } from '@/modules/orders/barrido'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * CRON DE PEDIDOS MEMBEGO (Commerce Core · Fase 3).
 *
 * Cancela los pedidos que la empresa no atendió en 7 días y libera lo que
 * tenían apartado. Mismo mecanismo que el resto de crons (`autorizarCron` +
 * `vercel.json`). Idempotente: correrlo dos veces no cancela nada dos veces.
 */
export async function GET(req: NextRequest) {
  const denegado = autorizarCron(req)
  if (denegado) return denegado
  const resultado = await barridoPedidos()
  return NextResponse.json({ ok: true, ...resultado })
}
