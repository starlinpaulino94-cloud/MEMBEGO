import { NextResponse, type NextRequest } from 'next/server'
import { autorizarCron } from '@/lib/cron-auth'
import { barridoPuente } from '@/modules/supply-bridge/barrido'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * CRON DEL PUENTE SUPPLY → CATÁLOGO (Commerce Core · Fase 2.5).
 *
 * Reconcilia todas las ofertas de Supply V2 no borrador con sus ítems del
 * catálogo de la empresa de la casa. Mismo mecanismo que el resto de crons
 * (`autorizarCron` + `vercel.json`). Idempotente.
 *
 * No es el camino normal: cada cambio de una oferta ya se sincroniza al
 * momento (`sincronizarOfertaMejorEsfuerzo`), y el público cruza el ítem con la
 * oferta en vivo. Esto recoge lo que ese camino no alcanzó.
 */
export async function GET(req: NextRequest) {
  const denegado = autorizarCron(req)
  if (denegado) return denegado
  const resultado = await barridoPuente()
  return NextResponse.json({ ok: true, ...resultado })
}
