import 'server-only'
import { sinEmpresa } from '@/lib/tenant'
import { anotarFallo } from '@/lib/prisma-errors'
import {
  construirPeticionWebPush,
  validarClavesVapid,
  type ClavesVapid,
} from './web-push/protocolo'
import type { NotificacionPush } from './push'

/**
 * WEB PUSH · EL ENVÍO (la parte que toca la base y la red).
 *
 * Es el hermano de `push.ts` (Expo, para la app nativa) para los navegadores:
 * la PWA instalada en el teléfono o una pestaña abierta. Mismo contrato y la
 * misma regla de la casa: FAIL-OPEN. Un aviso que no se puede entregar se
 * anota en el log y quien llamó sigue; una notificación nunca tumba un cobro
 * ni un cron.
 *
 * Qué hace con cada suscripción:
 *  - 201 / 2xx → entregado al servicio push (él se encarga de despertar el
 *    teléfono, aunque esté bloqueado o la app cerrada).
 *  - 404 / 410 → la persona revocó el permiso o desinstaló: se borra la fila.
 *    Insistir con un endpoint muerto es la forma de que FCM nos ponga en
 *    cuarentena.
 *  - Otros → se anota y se deja la fila: puede ser un fallo pasajero del
 *    servicio push.
 */

/** Las claves del entorno, validadas UNA vez por proceso. `null` = sin configurar. */
let clavesCacheadas: ClavesVapid | null | undefined

export function clavesVapid(): ClavesVapid | null {
  if (clavesCacheadas !== undefined) return clavesCacheadas
  const claves = {
    // La pública tiene que ser la MISMA que ve el navegador (`NEXT_PUBLIC_…`);
    // si no, el servicio push rechaza el JWT con 403 «VAPID key mismatch».
    publica: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ?? '',
    privada: process.env.VAPID_PRIVATE_KEY?.trim() ?? '',
    sujeto: process.env.VAPID_SUBJECT?.trim() || 'mailto:soporte@membego.com',
  }
  if (!claves.publica && !claves.privada) {
    clavesCacheadas = null
    return null
  }
  const motivo = validarClavesVapid(claves)
  if (motivo) {
    console.error(`[web-push] claves VAPID inválidas, no se enviarán avisos al navegador: ${motivo}`)
    clavesCacheadas = null
    return null
  }
  clavesCacheadas = claves
  return claves
}

/** Para la ruta que le da la clave pública al navegador. */
export function webPushConfigurado(): boolean {
  return clavesVapid() !== null
}

/** Lo que el service worker lee en el evento `push` (ver `public/sw.js`). */
export interface CargaWebPush {
  readonly id: string
  readonly titulo: string
  readonly mensaje: string
  readonly href: string
}

export function cargaDeAviso(notificacion: NotificacionPush): CargaWebPush {
  return {
    id: notificacion.id,
    titulo: notificacion.titulo,
    mensaje: notificacion.mensaje,
    // Sin ruta propia, la portada: el proxy lleva a cada rol a su inicio.
    href: notificacion.href ?? '/',
  }
}

const ENVIOS_EN_PARALELO = 20

export async function enviarWebPushNotificaciones(
  notificaciones: readonly NotificacionPush[],
  enviar: (url: string, init: RequestInit) => Promise<Response> = fetch,
): Promise<void> {
  if (notificaciones.length === 0) return
  const claves = clavesVapid()
  if (!claves) return

  try {
    const userIds = [...new Set(notificaciones.map((n) => n.userId))]
    const suscripciones = await sinEmpresa('web push: buscar suscripciones de destinatarios', (tx) =>
      tx.webPushSuscripcion.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, endpoint: true, p256dh: true, auth: true },
      }),
    )
    if (suscripciones.length === 0) return

    const porUsuario = new Map<string, typeof suscripciones>()
    for (const s of suscripciones) {
      const lista = porUsuario.get(s.userId) ?? []
      lista.push(s)
      porUsuario.set(s.userId, lista)
    }

    const envios: { endpoint: string; peticion: () => ReturnType<typeof construirPeticionWebPush> }[] = []
    for (const notificacion of notificaciones) {
      const carga = JSON.stringify(cargaDeAviso(notificacion))
      for (const s of porUsuario.get(notificacion.userId) ?? []) {
        envios.push({
          endpoint: s.endpoint,
          // `Topic`: si el teléfono estuvo apagado y el mismo aviso se reenvió,
          // el servicio push entrega solo el último.
          peticion: () => construirPeticionWebPush(claves, s, carga, { topic: topicDe(notificacion.id) }),
        })
      }
    }

    const muertos: string[] = []
    for (let i = 0; i < envios.length; i += ENVIOS_EN_PARALELO) {
      await Promise.all(
        envios.slice(i, i + ENVIOS_EN_PARALELO).map(async ({ endpoint, peticion }) => {
          try {
            const p = peticion()
            const respuesta = await enviar(p.url, {
              method: 'POST',
              headers: p.headers,
              body: new Uint8Array(p.body),
              signal: AbortSignal.timeout(10_000),
            })
            if (respuesta.status === 404 || respuesta.status === 410) {
              muertos.push(endpoint)
            } else if (!respuesta.ok) {
              console.error('[web-push] el servicio push rechazó el envío', {
                status: respuesta.status,
                servicio: new URL(endpoint).host,
              })
            }
          } catch (e) {
            console.error('[web-push] no se pudo contactar el servicio push', {
              servicio: new URL(endpoint).host,
              error: e instanceof Error ? e.name : 'unknown',
            })
          }
        }),
      )
    }

    if (muertos.length > 0) {
      await sinEmpresa('web push: retirar suscripciones revocadas (404/410)', (tx) =>
        tx.webPushSuscripcion.deleteMany({ where: { endpoint: { in: muertos } } }),
      ).catch(anotarFallo('web-push:retirar-revocadas'))
    }
  } catch (e) {
    console.error('[web-push] no se pudieron preparar los avisos', e instanceof Error ? e.name : 'unknown')
  }
}

/** RFC 8030 §5.4: hasta 32 caracteres de base64url. Los cuid caben. */
function topicDe(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32)
}
