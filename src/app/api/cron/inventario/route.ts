import { NextResponse, type NextRequest } from 'next/server'
import { autorizarCron } from '@/lib/cron-auth'
import { barridoInventario } from '@/modules/inventory/barrido'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * CRON DEL INVENTARIO (Commerce Core · Fase 2).
 *
 * Vence las reservas cuya hora pasó. Mismo mecanismo que el resto de crons
 * (`autorizarCron` + `vercel.json`). Idempotente: correrlo dos veces no mueve
 * nada dos veces.
 *
 * Vercel lo dispara una vez al día (el plan Hobby no admite crons más
 * frecuentes), pero el stock NO depende de él: toda operación sobre un saldo
 * vence antes, bajo el mismo candado, las reservas caducadas de ese saldo. El
 * barrido solo recoge lo que nadie volvió a tocar.
 */
export async function GET(req: NextRequest) {
  const denegado = autorizarCron(req)
  if (denegado) return denegado
  const resultado = await barridoInventario()
  return NextResponse.json({ ok: true, ...resultado })
}
