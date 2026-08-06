import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import type { NotifTipo } from '@prisma/client'
import { FULL_ADMIN_ROLES } from '@/types'

// Helpers internos de notificación. IMPORTANTE: este archivo NO lleva
// 'use server' — así estas funciones no quedan expuestas como endpoints
// invocables; solo pueden llamarse desde código de servidor (actions guarded).

export async function crearNotificacion(data: {
  userId: string
  tipo: NotifTipo
  titulo: string
  mensaje: string
  href?: string
}) {
  try {
    await sinEmpresa('notificaciones: crear por usuario (un usuario puede ser de varias empresas)', (tx) =>
      tx.notificacion.create({ data })
    )
  } catch (e) {
    console.error('[notificacion] create error', e)
  }
}

/**
 * Notifica a los administradores PLENOS de una empresa.
 *
 * Antes filtraba `role: 'ADMIN_EMPRESA'`, que es el rol LEGACY (así está
 * marcado en el esquema). Los administradores que crea `crearEmpresa` nacen
 * como `ADMINISTRADOR`, así que ninguna empresa dada de alta por el flujo
 * actual recibía un solo aviso: ni pago pendiente, ni comprobante subido, ni
 * nada. El fallo no daba error — simplemente la campanita nunca sonaba.
 *
 * `FULL_ADMIN_ROLES` incluye el legacy, así que las empresas antiguas siguen
 * recibiendo lo suyo.
 */
export async function notificarAdmins(
  companyId: string,
  payload: { tipo: NotifTipo; titulo: string; mensaje: string; href?: string }
) {
  try {
    await conEmpresa(companyId, async (tx) => {
      const admins = await tx.user.findMany({
        where: { companyId, role: { in: FULL_ADMIN_ROLES } },
        select: { id: true },
      })
      if (admins.length === 0) return
      await tx.notificacion.createMany({
        data: admins.map((a) => ({ userId: a.id, ...payload })),
      })
    })
  } catch (e) {
    console.error('[notificacion] notificarAdmins error', e)
  }
}

/**
 * ENVÍO MASIVO: SE ENCOLA, NO SE HACE AQUÍ (auditoría · C-07).
 *
 * Antes estas funciones leían TODOS los destinatarios de la empresa y hacían un
 * único `createMany` dentro del request. Con 50.000 clientes eso es un INSERT
 * de 50.000 filas en una función serverless con límite de tiempo y memoria,
 * bloqueando la respuesta al administrador que pulsó el botón — y dejando la
 * notificación a medias si se agotaba el tiempo.
 *
 * Ahora se encola el PRIMER LOTE y se devuelve al instante. El ejecutor procesa
 * mil destinatarios y, si quedan más, se encadena a sí mismo. El administrador
 * ve la pantalla responder en milisegundos pase lo que pase.
 *
 * Sin QStash configurado el trabajo se ejecuta en línea (ver `encolar`): más
 * lento, pero nunca se pierde el envío en silencio.
 */
async function encolarFanOut(
  companyId: string,
  audiencia: 'clientes' | 'seguidores',
  payload: { tipo: NotifTipo; titulo: string; mensaje: string; href?: string }
) {
  try {
    const { encolar } = await import('@/modules/jobs/cola')
    await encolar({ tipo: 'notificar', companyId, audiencia, payload, desde: 0 })
  } catch (e) {
    console.error('[notificacion] no se pudo encolar el envío', audiencia, e)
  }
}

/**
 * Notifica a todo CLIENTE con cuenta en la empresa (cualquier fila cliente
 * con ese companyId, soporte multi-empresa).
 */
export async function notificarClientesEmpresa(
  companyId: string,
  payload: { tipo: NotifTipo; titulo: string; mensaje: string; href?: string }
) {
  await encolarFanOut(companyId, 'clientes', payload)
}

/**
 * FASE 3: Notifica únicamente a los seguidores de la empresa (CompanyFollow).
 * Regla del marketplace social: nunca notificar a usuarios que no siguen la
 * empresa. Los clientes existentes se convirtieron en seguidores vía backfill.
 */
export async function notificarSeguidoresEmpresa(
  companyId: string,
  payload: { tipo: NotifTipo; titulo: string; mensaje: string; href?: string }
) {
  await encolarFanOut(companyId, 'seguidores', payload)
}
