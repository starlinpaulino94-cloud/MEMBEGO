import 'server-only'
import { AUTOMATION_EVENTS } from '@/lib/automation'
import { emitirEventoEstrategia } from '@/modules/estrategias/eventos'
import type { Canal } from '@/modules/mensajeria/nucleo'

/**
 * LO QUE LA MENSAJERÍA CUENTA A LAS AUTOMATIZACIONES (Meta · Fase 7).
 *
 * Dos eventos, con sus hechos por namespace para que una regla pueda
 * condicionar (`mensaje.canal == 'WHATSAPP'`, `mensaje.primero`) e
 * interpolar (`{{contacto.nombre}}`, `{{mensaje.conversacionId}}`). El
 * `subjectId` es el Cliente si el contacto ya está enlazado a uno; si no,
 * null: las acciones que necesitan un cliente lo dicen y no rompen.
 *
 * `emitirEventoEstrategia` nunca lanza: un fallo del bus no toca el mensaje
 * ya guardado.
 */

export async function emitirMensajeRecibido(input: {
  companyId: string
  canal: Canal
  conversacionId: string
  contactoId: string
  clienteId: string | null
  tipo: string
  texto: string | null
  nombre: string | null
  telefono: string | null
  /** ¿Es la primera vez que este contacto escribe? */
  primero: boolean
}): Promise<void> {
  await emitirEventoEstrategia({
    companyId: input.companyId,
    type: AUTOMATION_EVENTS.MESSAGE_RECEIVED,
    subjectId: input.clienteId,
    payload: {
      mensaje: {
        canal: input.canal,
        tipo: input.tipo,
        texto: input.texto ?? '',
        conversacionId: input.conversacionId,
        contactoId: input.contactoId,
        primero: input.primero,
      },
      contacto: { id: input.contactoId, nombre: input.nombre ?? '', telefono: input.telefono ?? '', clienteId: input.clienteId },
    },
  })
}

export async function emitirProspectoCreado(input: {
  companyId: string
  prospectoId: string
  canal: Canal
  conversacionId: string
  contactoId: string
  nombre: string | null
  telefono: string | null
}): Promise<void> {
  await emitirEventoEstrategia({
    companyId: input.companyId,
    type: AUTOMATION_EVENTS.PROSPECT_CREATED,
    subjectId: null,
    payload: {
      prospecto: { id: input.prospectoId, canal: input.canal, conversacionId: input.conversacionId },
      contacto: { id: input.contactoId, nombre: input.nombre ?? '', telefono: input.telefono ?? '' },
    },
  })
}
