import { NextResponse, type NextRequest } from 'next/server'
import { ejecutarRenovacionesTarjeta } from '@/modules/pagos/cardnetTokenGuardado'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Fase 2 CardNET: cron de renovaciones automáticas con tarjeta guardada.
 * Cobra las membresías ACTIVA con `autoRenovar` y tarjeta activa que están por
 * vencer, y las extiende. Idempotente (ver `renovarMembresiaPorTarjeta`).
 *
 * Protegido con CRON_SECRET (igual que /api/cron/automatizaciones). Llamar con
 * `Authorization: Bearer <CRON_SECRET>`. Programado a diario en vercel.json.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET no configurado.' }, { status: 503 })
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 401 })
  }

  try {
    const resumen = await ejecutarRenovacionesTarjeta()
    return NextResponse.json({ ok: true, ...resumen })
  } catch (e) {
    console.error('[cron-renovaciones-tarjeta]', e)
    return NextResponse.json({ error: 'Error interno.' }, { status: 500 })
  }
}
