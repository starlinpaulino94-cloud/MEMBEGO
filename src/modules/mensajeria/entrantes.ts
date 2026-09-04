import 'server-only'
import { Prisma } from '@prisma/client'
import { conEmpresa } from '@/lib/tenant'
import { activoPorIdExterno } from '@/modules/connect/meta/activos'
import type { EventoMetaFila } from '@/modules/connect/meta/webhookDispatcher'
import { resolverContacto } from '@/modules/mensajeria/contactos'
import {
  avanzaEstado,
  estadoDesdeMeta,
  leerEntranteWhatsapp,
  leerEstadoWhatsapp,
  vistaPrevia,
} from '@/modules/mensajeria/nucleo'

/**
 * LO QUE ENTRA POR WHATSAPP (Meta · Fase 2): mensajes de clientes y estados
 * de lo que enviamos. Son los manejadores del despachador para
 * `whatsapp_business_account` · `messages` y `statuses`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * IDEMPOTENTE DOS VECES
 *
 * El evento ya es único en `EventoMeta`; el mensaje vuelve a serlo en
 * `Mensaje` por (canal, idExterno). Si Meta mandó el mismo wamid en dos
 * lotes distintos, el segundo choca con el UNIQUE y se ignora. Los estados
 * solo AVANZAN: un `delivered` que llega después de un `read` no retrocede.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL ACTIVO ES EL NÚMERO
 *
 * El dueño del evento viene resuelto (activoId = el número, o el WABA). Una
 * conexión hecha antes de ActivoMeta no lo trae: se intenta por el
 * `phone_number_id` que viaja en `metadata`, y si tampoco, se anota y se
 * deja sin procesar para cuando el número se reclame.
 */

async function activoDelNumero(ev: EventoMetaFila): Promise<{ id: string } | null> {
  if (ev.activoId) return { id: ev.activoId }
  const payload = ev.payload as { metadata?: { phone_number_id?: string } } | null
  const phoneNumberId = payload?.metadata?.phone_number_id
  if (typeof phoneNumberId !== 'string' || !phoneNumberId) return null
  const activo = await activoPorIdExterno('PHONE_NUMBER', phoneNumberId)
  return activo && activo.companyId === ev.companyId ? { id: activo.id } : null
}

export async function registrarEntranteWhatsapp(ev: EventoMetaFila): Promise<string> {
  const mensaje = leerEntranteWhatsapp(ev.payload)
  if (!mensaje) return 'ilegible'

  const activo = await activoDelNumero(ev)
  if (!activo) throw new Error('el número de este evento no está reclamado como activo')

  const contacto = await resolverContacto({
    companyId: ev.companyId,
    canal: 'WHATSAPP',
    idExterno: mensaje.de,
    nombre: mensaje.nombre,
  })

  return conEmpresa(ev.companyId, async (tx) => {
    const conversacion = await tx.conversacion.upsert({
      where: {
        companyId_activoId_contactoId: {
          companyId: ev.companyId,
          activoId: activo.id,
          contactoId: contacto.id,
        },
      },
      create: {
        companyId: ev.companyId,
        canal: 'WHATSAPP',
        activoId: activo.id,
        contactoId: contacto.id,
        estado: 'ABIERTA',
        ultimoEntranteAt: mensaje.timestamp,
        ultimoMensajeAt: mensaje.timestamp,
        ultimoTexto: vistaPrevia(mensaje.tipo, mensaje.texto),
        noLeidos: 1,
      },
      // Un entrante REABRE la conversación y suma un no leído. Las fechas
      // solo avanzan: un evento que llega tarde no las mueve hacia atrás.
      update: {
        estado: 'ABIERTA',
        noLeidos: { increment: 1 },
      },
      select: { id: true, ultimoEntranteAt: true, ultimoMensajeAt: true },
    })

    const masReciente =
      !conversacion.ultimoMensajeAt || mensaje.timestamp > conversacion.ultimoMensajeAt
    const entranteMasReciente =
      !conversacion.ultimoEntranteAt || mensaje.timestamp > conversacion.ultimoEntranteAt
    if (masReciente || entranteMasReciente) {
      await tx.conversacion.update({
        where: { id: conversacion.id },
        data: {
          ...(entranteMasReciente ? { ultimoEntranteAt: mensaje.timestamp } : {}),
          ...(masReciente
            ? { ultimoMensajeAt: mensaje.timestamp, ultimoTexto: vistaPrevia(mensaje.tipo, mensaje.texto) }
            : {}),
        },
      })
    }

    try {
      await tx.mensaje.create({
        data: {
          companyId: ev.companyId,
          conversacionId: conversacion.id,
          canal: 'WHATSAPP',
          direccion: 'ENTRANTE',
          idExterno: mensaje.idExterno,
          tipo: mensaje.tipo,
          texto: mensaje.texto,
          adjuntos: (mensaje.adjuntos ?? undefined) as Prisma.InputJsonObject | undefined,
          estado: 'RECIBIDO',
          contextoIdExterno: mensaje.contextoIdExterno,
          timestamp: mensaje.timestamp,
        },
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        // Ya lo teníamos: deshacer el no leído que acabamos de sumar.
        await tx.conversacion.update({
          where: { id: conversacion.id },
          data: { noLeidos: { decrement: 1 } },
        })
        return 'duplicado'
      }
      throw e
    }
    return `entrante ${mensaje.tipo}`
  })
}

export async function aplicarEstadoWhatsapp(ev: EventoMetaFila): Promise<string> {
  const estado = leerEstadoWhatsapp(ev.payload)
  if (!estado) return 'ilegible'
  const nuevo = estadoDesdeMeta(estado.estadoMeta)
  if (!nuevo) return `estado desconocido: ${estado.estadoMeta}`

  return conEmpresa(ev.companyId, async (tx) => {
    const mensaje = await tx.mensaje.findUnique({
      where: { canal_idExterno: { canal: 'WHATSAPP', idExterno: estado.idExterno } },
      select: { id: true, companyId: true, estado: true },
    })
    // Un estado de algo que no registramos (un envío anterior a esta fase, o
    // hecho desde otra herramienta con el mismo número) no es un error.
    if (!mensaje || mensaje.companyId !== ev.companyId) return 'sin mensaje'
    if (!avanzaEstado(mensaje.estado, nuevo)) return `sin cambio (${mensaje.estado})`

    await tx.mensaje.update({
      where: { id: mensaje.id },
      data: {
        estado: nuevo,
        ...(nuevo === 'FALLIDO'
          ? { errorCodigo: estado.errorCodigo, errorDetalle: estado.errorDetalle }
          : {}),
      },
    })
    return `→ ${nuevo}`
  })
}
