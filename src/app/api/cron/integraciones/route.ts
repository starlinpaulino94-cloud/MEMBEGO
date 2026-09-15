import { NextResponse, type NextRequest } from 'next/server'
import { autorizarCron } from '@/lib/cron-auth'
import { reintentarPendientes } from '@/modules/integraciones/despacho'
import { reintentarWebhooksPendientes } from '@/modules/connect/webhooks'
import { purgarEstadosOauth } from '@/modules/connect/oauth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * CRON: LA RED DE SEGURIDAD de las dos colas de salida.
 *
 * Ya NO es quien reintenta. Desde los reintentos programados (auditoría A-1),
 * cada entrega fallida deja su siguiente intento en la cola con espera
 * creciente (30 s → 24 h), y este barrido diario recoge únicamente lo que se
 * quedó sin programar: QStash sin configurar, una publicación rechazada, un
 * mensaje perdido.
 *
 * Por eso toma solo lo VENCIDO. Si atendiera todo lo pendiente, le gastaría el
 * intento a entregas que ya lo tienen programado para dentro de seis horas — y
 * la escalera volvería a ser lo que era: una vez al día.
 */
export async function GET(req: NextRequest) {
  const denegado = autorizarCron(req)
  if (denegado) return denegado
  const satelites = await reintentarPendientes()  // solo lo vencido; ver arriba
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
