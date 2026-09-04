import 'server-only'
import { conEmpresa } from '@/lib/tenant'
import { cuerpoMensajePlantilla, type Canal } from '@/modules/mensajeria/nucleo'
import { enviarPlantillaEnConversacion, enviarTextoEnConversacion } from '@/modules/mensajeria/salientes'

/**
 * ENVIAR DESDE UNA AUTOMATIZACIÓN (Meta · Fase 7).
 *
 * Una regla no elige un teléfono ni un id de Meta: elige un CANAL y, o bien
 * la conversación en la que responde (`conversacionId`, normalmente
 * `{{mensaje.conversacionId}}` del disparador «mensaje recibido»), o bien
 * el cliente sobre el que corre (`subjectId`), del que se toma su última
 * conversación abierta por ese canal.
 *
 * LA VENTANA MANDA, igual que en la bandeja: texto libre solo dentro de las
 * 24 h; fuera, por WhatsApp una plantilla APROBADA con sus parámetros, y por
 * Messenger e Instagram nada (se espera al cliente). Por WhatsApp sin
 * conversación registrada se conserva el comportamiento anterior —texto al
 * teléfono del cliente, y Meta decide—, para que una regla publicada antes de
 * la mensajería siga funcionando igual.
 *
 * Todo envío queda en su conversación con `origen: 'automatizacion'`.
 */

export interface EnvioAutomatizado {
  companyId: string
  canal: Canal
  subjectId: string | null
  conversacionId: string | null
  texto: string | null
  /** Nombre de plantilla aprobada (solo WhatsApp). */
  plantilla: string | null
  parametros: string[]
}

export type ResultadoAutomatizado = { ok: boolean; detail: Record<string, unknown> }

const ID_VALIDO = /^[a-z0-9]{10,40}$/i

/** Lee los parámetros de una acción del motor, ya interpolados. */
export function leerParametrosDeEnvio(params: Record<string, unknown>): {
  texto: string | null
  plantilla: string | null
  parametros: string[]
  conversacionId: string | null
} {
  const texto = String(params.body ?? params.message ?? '').trim() || null
  const plantilla = typeof params.template === 'string' && params.template.trim() ? params.template.trim() : null
  const crudo = params.templateParams
  const parametros = Array.isArray(crudo)
    ? crudo.map((v) => String(v ?? '').trim())
    : typeof crudo === 'string' && crudo.trim()
      ? crudo.split('|').map((v) => v.trim())
      : []
  const conversacionId = typeof params.conversacionId === 'string' && ID_VALIDO.test(params.conversacionId) ? params.conversacionId : null
  return { texto, plantilla, parametros, conversacionId }
}

async function conversacionObjetivo(e: EnvioAutomatizado): Promise<{ id: string } | null> {
  return conEmpresa(e.companyId, (tx) => {
    if (e.conversacionId) {
      return tx.conversacion.findFirst({ where: { id: e.conversacionId, companyId: e.companyId, canal: e.canal }, select: { id: true } })
    }
    if (e.subjectId) {
      return tx.conversacion.findFirst({
        where: { companyId: e.companyId, canal: e.canal, contacto: { clienteId: e.subjectId } },
        orderBy: { ultimoMensajeAt: { sort: 'desc', nulls: 'last' } },
        select: { id: true },
      })
    }
    return Promise.resolve(null)
  })
}

async function telefonoDelCliente(companyId: string, clienteId: string | null): Promise<string | null> {
  if (!clienteId) return null
  const c = await conEmpresa(companyId, (tx) => tx.cliente.findFirst({ where: { id: clienteId, companyId }, select: { telefono: true } }))
  return c?.telefono?.trim() || null
}

export async function enviarDesdeAutomatizacion(e: EnvioAutomatizado): Promise<ResultadoAutomatizado> {
  const channel = e.canal.toLowerCase()
  if (!e.texto && !e.plantilla) return { ok: true, detail: { simulated: true, reason: 'sin texto ni plantilla' } }
  if (e.plantilla && e.canal !== 'WHATSAPP') return { ok: false, detail: { channel, motivo: 'plantilla_solo_whatsapp' } }

  const conversacion = await conversacionObjetivo(e)

  if (e.plantilla) {
    const plantilla = await conEmpresa(e.companyId, (tx) =>
      tx.plantillaWhatsapp.findFirst({
        where: { companyId: e.companyId, nombre: e.plantilla!, estado: 'APPROVED' },
        orderBy: { idioma: 'asc' },
        select: { id: true, nombre: true, idioma: true, variables: true },
      })
    )
    if (!plantilla) return { ok: false, detail: { channel, motivo: 'plantilla_no_aprobada', plantilla: e.plantilla } }
    if (plantilla.variables !== e.parametros.length) {
      return { ok: false, detail: { channel, motivo: 'parametros', esperados: plantilla.variables, recibidos: e.parametros.length } }
    }
    if (conversacion) {
      const r = await enviarPlantillaEnConversacion({
        companyId: e.companyId,
        conversacionId: conversacion.id,
        plantillaId: plantilla.id,
        parametros: e.parametros,
        enviadoPorId: null,
        origen: 'automatizacion',
      })
      return r.ok ? { ok: true, detail: { channel, mensajeId: r.mensajeId, plantilla: plantilla.nombre } } : { ok: false, detail: { channel, motivo: r.motivo, detalle: r.detalle } }
    }
    // Sin conversación: una plantilla puede ABRIRLA (es para eso). Va al teléfono del cliente.
    const telefono = await telefonoDelCliente(e.companyId, e.subjectId)
    if (!telefono) return { ok: true, detail: { simulated: true, reason: 'cliente sin teléfono' } }
    const { enviarCuerpoWhatsapp } = await import('@/modules/connect/whatsapp')
    const para = telefono.replace(/\D/g, '')
    const r = await enviarCuerpoWhatsapp({
      companyId: e.companyId,
      para,
      cuerpo: cuerpoMensajePlantilla(para, plantilla.nombre, plantilla.idioma, e.parametros),
      registro: {
        tipo: 'template',
        texto: null,
        plantilla: { nombre: plantilla.nombre, idioma: plantilla.idioma, parametros: e.parametros },
        enviadoPorId: null,
        origen: 'automatizacion',
      },
    })
    return r.ok ? { ok: true, detail: { channel, mensajeId: r.mensajeId, plantilla: plantilla.nombre } } : { ok: false, detail: { channel, motivo: r.motivo, detalle: r.detalle } }
  }

  // Texto libre.
  if (conversacion) {
    const r = await enviarTextoEnConversacion({
      companyId: e.companyId,
      conversacionId: conversacion.id,
      texto: e.texto!,
      enviadoPorId: null,
      origen: 'automatizacion',
    })
    return r.ok ? { ok: true, detail: { channel, mensajeId: r.mensajeId } } : { ok: false, detail: { channel, motivo: r.motivo, detalle: r.detalle } }
  }
  if (e.canal !== 'WHATSAPP') {
    // Messenger e Instagram no se pueden iniciar desde el negocio.
    return { ok: true, detail: { simulated: true, reason: 'sin conversación abierta por este canal' } }
  }
  const telefono = await telefonoDelCliente(e.companyId, e.subjectId)
  if (!telefono) return { ok: true, detail: { simulated: true, reason: 'cliente sin teléfono' } }
  const { enviarWhatsapp } = await import('@/modules/connect/whatsapp')
  const r = await enviarWhatsapp({ companyId: e.companyId, telefono, texto: e.texto!, registro: { enviadoPorId: null, origen: 'automatizacion' } })
  return r.ok ? { ok: true, detail: { channel, mensajeId: r.mensajeId } } : { ok: false, detail: { channel, motivo: r.motivo, detalle: r.detalle } }
}
