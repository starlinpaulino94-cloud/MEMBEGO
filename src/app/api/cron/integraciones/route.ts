import { NextResponse, type NextRequest } from 'next/server'
import { autorizarCron } from '@/lib/cron-auth'
import { reintentarPendientes } from '@/modules/integraciones/despacho'
import { reintentarWebhooksPendientes } from '@/modules/connect/webhooks'
import { purgarEstadosOauth } from '@/modules/connect/oauth'

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
  const satelites = await reintentarPendientes()
  // Los webhooks de empresa (Connect · F3) comparten cron con los satélites: son
  // el mismo trabajo —vaciar una cola de entregas pendientes— y separarlos en
  // dos crons gastaría una de las ranuras del plan sin ganar nada.
  const webhooks = await reintentarWebhooksPendientes()
  // Un flujo OAuth abandonado deja una fila con su `code_verifier`. Caducan a
  // los 15 minutos y dejan de servir para nada, pero conservarlas para siempre
  // sería guardar secretos que ya no protegen nada.
  const estadosOauthPurgados = await purgarEstadosOauth()
  return NextResponse.json({ ok: true, satelites, webhooks, estadosOauthPurgados })
}
