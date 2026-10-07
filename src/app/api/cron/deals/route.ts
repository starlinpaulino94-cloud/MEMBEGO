import { NextResponse, type NextRequest } from 'next/server'
import { autorizarCron } from '@/lib/cron-auth'
import { barridoDeOfertas } from '@/modules/deals/barrido'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * CRON DE OFERTAS CON PRESUPUESTO (Commerce Core · Fase 5).
 *
 * Cierra los cupones que vencieron sin canjearse (libera el cupo, el stock y la parte reservada
 * del presupuesto) y da por terminadas las ofertas cuya vigencia pasó. Mismo mecanismo que el
 * resto de crons (`autorizarCron` + `vercel.json`). Idempotente: correrlo dos veces no cierra
 * nada dos veces.
 */
export async function GET(req: NextRequest) {
  const denegado = autorizarCron(req)
  if (denegado) return denegado
  const resultado = await barridoDeOfertas()
  return NextResponse.json({ ok: true, ...resultado })
}
