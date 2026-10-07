import { NextResponse, type NextRequest } from 'next/server'
import { autorizarCron } from '@/lib/cron-auth'
import { barridoFacturacion } from '@/modules/billing/barrido'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * CRON DE MERCHANT BILLING (Commerce Core · Fase 4).
 *
 * Cobra los pedidos completados que quedaron sin comisión, suspende las cuentas cuya
 * gracia venció con el saldo aún por encima del límite y emite los estados de cuenta
 * de los periodos cerrados. Mismo mecanismo que el resto de crons (`autorizarCron` +
 * `vercel.json`). Idempotente: correrlo dos veces no cobra ni corta nada dos veces.
 */
export async function GET(req: NextRequest) {
  const denegado = autorizarCron(req)
  if (denegado) return denegado
  const resultado = await barridoFacturacion()
  return NextResponse.json({ ok: true, ...resultado })
}
