import { NextResponse, type NextRequest } from 'next/server'
import { autorizarCron } from '@/lib/cron-auth'
import { reintentarPendientes } from '@/modules/integraciones/despacho'
import { reintentarWebhooksPendientes } from '@/modules/connect/webhooks'
import { purgarEstadosOauth } from '@/modules/connect/oauth'
import { comprobarSaludConexiones } from '@/modules/connect/salud-conexiones'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Lo que puede consumir CADA cola de este cron.
 *
 * Dos colas y una purga dentro de sesenta segundos. Veinte para cada cola deja
 * un resto holgado para la purga de estados OAuth —que es SQL y tarda
 * milisegundos— y para el margen que cada barrido se reserva a sí mismo para
 * terminar lo que tenga en vuelo.
 *
 * Los barridos DEJAN TRABAJO SIN HACER cuando se acaba su tiempo, y lo dicen en
 * `sinTiempo`. Eso no es una degradación: es lo correcto para un barrido que,
 * desde los reintentos programados (A-1), ya no es quien reintenta sino la red
 * de seguridad. Lo que no puede pasar —y pasaba— es que la plataforma mate la
 * función a mitad de una entrega y nadie se entere de que quedaron noventa
 * filas sin tocar.
 */
const PRESUPUESTO_POR_COLA_MS = 20_000

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
  const satelites = await reintentarPendientes(100, undefined, {
    presupuestoMs: PRESUPUESTO_POR_COLA_MS,
  })
  // Los webhooks de empresa (Connect · F3) comparten cron con los satélites: son
  // el mismo trabajo —vaciar una cola de entregas pendientes— y separarlos en
  // dos crons gastaría una de las ranuras del plan sin ganar nada.
  //
  // Compartir cron significa compartir presupuesto, y por eso cada una recibe
  // el suyo: sin repartirlo, la primera podría consumirlo entero y la segunda
  // no llegaría a intentar ni una entrega — un fallo que además solo aparece
  // cuando una de las dos colas va mal, o sea el día que más importa.
  const webhooks = await reintentarWebhooksPendientes(100, PRESUPUESTO_POR_COLA_MS)
  // Un flujo OAuth abandonado deja una fila con su `code_verifier`. Caducan a
  // los 15 minutos y dejan de servir para nada, pero conservarlas para siempre
  // sería guardar secretos que ya no protegen nada.
  const estadosOauthPurgados = await purgarEstadosOauth()
  // SALUD ACTIVA (B-3): mira la caducidad de las credenciales sin refresco y
  // marca las que se acercan a su fin, para que la empresa reconecte ANTES de
  // que un envío falle. Es una consulta local y barata —no abre sellos ni llama
  // a ningún proveedor—, así que no compite por el presupuesto de las colas.
  const salud = await comprobarSaludConexiones()
  return NextResponse.json({ ok: true, satelites, webhooks, estadosOauthPurgados, salud })
}
