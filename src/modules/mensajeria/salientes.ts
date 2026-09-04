import 'server-only'
import type { Prisma } from '@prisma/client'
import { conEmpresa } from '@/lib/tenant'
import { activoPorIdExterno } from '@/modules/connect/meta/activos'
import { resolverContacto } from '@/modules/mensajeria/contactos'
import {
  cuerpoMarcarLeido,
  cuerpoMensajePlantilla,
  ventanaAbierta,
  vistaPrevia,
} from '@/modules/mensajeria/nucleo'

/**
 * LO QUE SALE POR WHATSAPP (Meta · Fase 2).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TODO ENVÍO QUEDA EN SU CONVERSACIÓN
 *
 * Venga de la bandeja o de una automatización, un mensaje enviado se
 * registra en el hilo del contacto, con quién lo mandó y de dónde. Es lo que
 * hace que la bandeja cuente la historia completa y no solo la mitad que
 * escribió una persona. `registrarSalienteWhatsapp` lo llama el propio
 * conector (`whatsapp.ts`) después de cada envío; best-effort.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA VENTANA MANDA
 *
 * Texto libre solo dentro de las 24 h desde el último mensaje del cliente;
 * fuera, una plantilla aprobada. Se comprueba ANTES de llamar a Meta: el
 * error 131047 de Meta sería la misma respuesta, pero después de gastar una
 * llamada y con un mensaje menos claro para quien escribe.
 */

export async function registrarSalienteWhatsapp(input: {
  companyId: string
  phoneNumberId: string
  /** El wa_id del destinatario (E.164 sin «+»). */
  para: string
  tipo: 'text' | 'template'
  texto: string | null
  plantilla?: Record<string, unknown> | null
  idExterno: string | null
  estado: 'ENVIADO' | 'FALLIDO'
  errorCodigo?: number | null
  errorDetalle?: string | null
  enviadoPorId?: string | null
  origen?: string | null
}): Promise<{ conversacionId: string; mensajeId: string } | null> {
  const activo = await activoPorIdExterno('PHONE_NUMBER', input.phoneNumberId)
  // Un número no reclamado (conexión anterior a ActivoMeta) no tiene hilo
  // donde caer; el envío ya ocurrió y queda en la salud de la conexión.
  if (!activo || activo.companyId !== input.companyId) return null

  const contacto = await resolverContacto({
    companyId: input.companyId,
    canal: 'WHATSAPP',
    idExterno: input.para,
  })
  const ahora = new Date()

  return conEmpresa(input.companyId, async (tx) => {
    const conversacion = await tx.conversacion.upsert({
      where: {
        companyId_activoId_contactoId: {
          companyId: input.companyId,
          activoId: activo.id,
          contactoId: contacto.id,
        },
      },
      create: {
        companyId: input.companyId,
        canal: 'WHATSAPP',
        activoId: activo.id,
        contactoId: contacto.id,
        ultimoMensajeAt: ahora,
        ultimoTexto: vistaPrevia(input.tipo, input.texto),
      },
      update: {
        ultimoMensajeAt: ahora,
        ultimoTexto: vistaPrevia(input.tipo, input.texto),
      },
      select: { id: true },
    })
    const mensaje = await tx.mensaje.create({
      data: {
        companyId: input.companyId,
        conversacionId: conversacion.id,
        canal: 'WHATSAPP',
        direccion: 'SALIENTE',
        idExterno: input.idExterno,
        tipo: input.tipo,
        texto: input.texto,
        plantilla: (input.plantilla ?? undefined) as Prisma.InputJsonObject | undefined,
        estado: input.estado,
        errorCodigo: input.errorCodigo ?? null,
        errorDetalle: input.errorDetalle ?? null,
        enviadoPorId: input.enviadoPorId ?? null,
        origen: input.origen ?? null,
        timestamp: ahora,
      },
      select: { id: true },
    })
    return { conversacionId: conversacion.id, mensajeId: mensaje.id }
  })
}

export type ResultadoEnvioConversacion =
  | { ok: true; mensajeId: string | null }
  | {
      ok: false
      motivo: 'no_existe' | 'canal' | 'ventana_cerrada' | 'sin_conexion' | 'sin_credencial' | 'telefono_invalido' | 'proveedor'
      detalle?: string
    }

async function conversacionDe(companyId: string, conversacionId: string) {
  return conEmpresa(companyId, (tx) =>
    tx.conversacion.findFirst({
      where: { id: conversacionId, companyId },
      select: {
        id: true,
        canal: true,
        ultimoEntranteAt: true,
        contacto: { select: { idExterno: true } },
      },
    })
  )
}

/** Texto libre desde la bandeja: solo con la ventana abierta. */
export async function enviarTextoEnConversacion(input: {
  companyId: string
  conversacionId: string
  texto: string
  /** Quién lo envió desde la bandeja; null si fue una automatización. */
  enviadoPorId: string | null
  origen?: 'bandeja' | 'automatizacion'
}): Promise<ResultadoEnvioConversacion> {
  const c = await conversacionDe(input.companyId, input.conversacionId)
  if (!c) return { ok: false, motivo: 'no_existe' }
  if (c.canal === 'MESSENGER' || c.canal === 'INSTAGRAM') {
    // Messenger e Instagram: token de Página, mismo módulo (Meta · Fase 3).
    const { enviarTextoMensajeria } = await import('@/modules/mensajeria/messenger')
    const r = await enviarTextoMensajeria(input)
    return r.ok ? { ok: true, mensajeId: r.mensajeId } : { ok: false, motivo: r.motivo === 'sin_token' ? 'sin_credencial' : r.motivo, detalle: r.detalle }
  }
  if (c.canal !== 'WHATSAPP') return { ok: false, motivo: 'canal' }
  if (!ventanaAbierta(c.ultimoEntranteAt)) return { ok: false, motivo: 'ventana_cerrada' }

  const { enviarWhatsapp } = await import('@/modules/connect/whatsapp')
  const r = await enviarWhatsapp({
    companyId: input.companyId,
    telefono: c.contacto.idExterno,
    texto: input.texto,
    registro: { enviadoPorId: input.enviadoPorId, origen: input.origen ?? 'bandeja' },
  })
  return r.ok ? { ok: true, mensajeId: r.mensajeId } : { ok: false, motivo: r.motivo, detalle: r.detalle }
}

/**
 * Plantilla aprobada desde la bandeja: vale con la ventana cerrada. ⚠ El
 * cuerpo (`cuerpoMensajePlantilla`) está pendiente de verificar contra la
 * colección oficial de Postman antes del primer envío real.
 */
export async function enviarPlantillaEnConversacion(input: {
  companyId: string
  conversacionId: string
  plantillaId: string
  parametros: string[]
  enviadoPorId: string | null
  origen?: 'bandeja' | 'automatizacion'
}): Promise<ResultadoEnvioConversacion> {
  const c = await conversacionDe(input.companyId, input.conversacionId)
  if (!c) return { ok: false, motivo: 'no_existe' }
  if (c.canal !== 'WHATSAPP') return { ok: false, motivo: 'canal' }

  const plantilla = await conEmpresa(input.companyId, (tx) =>
    tx.plantillaWhatsapp.findFirst({
      where: { id: input.plantillaId, companyId: input.companyId, estado: 'APPROVED' },
      select: { nombre: true, idioma: true, variables: true },
    })
  )
  if (!plantilla) return { ok: false, motivo: 'no_existe', detalle: 'plantilla no aprobada o inexistente' }
  if (plantilla.variables !== input.parametros.length) {
    return {
      ok: false,
      motivo: 'proveedor',
      detalle: `la plantilla lleva ${plantilla.variables} parámetros y llegaron ${input.parametros.length}`,
    }
  }

  const { enviarCuerpoWhatsapp } = await import('@/modules/connect/whatsapp')
  const r = await enviarCuerpoWhatsapp({
    companyId: input.companyId,
    para: c.contacto.idExterno,
    cuerpo: cuerpoMensajePlantilla(c.contacto.idExterno, plantilla.nombre, plantilla.idioma, input.parametros),
    registro: {
      tipo: 'template',
      texto: null,
      plantilla: { nombre: plantilla.nombre, idioma: plantilla.idioma, parametros: input.parametros },
      enviadoPorId: input.enviadoPorId,
      origen: input.origen ?? 'bandeja',
    },
  })
  return r.ok ? { ok: true, mensajeId: r.mensajeId } : { ok: false, motivo: r.motivo, detalle: r.detalle }
}

/**
 * Marcar la conversación como leída: en nuestra base (contador) y en Meta
 * (los dos ticks azules del cliente), best-effort y solo para el último
 * entrante — Meta marca como leídos todos los anteriores a ese.
 */
export async function marcarConversacionLeida(input: {
  companyId: string
  conversacionId: string
}): Promise<void> {
  const ultimo = await conEmpresa(input.companyId, async (tx) => {
    const r = await tx.conversacion.updateMany({
      where: { id: input.conversacionId, companyId: input.companyId },
      data: { noLeidos: 0 },
    })
    if (r.count === 0) return null
    return tx.mensaje.findFirst({
      where: { conversacionId: input.conversacionId, direccion: 'ENTRANTE', canal: 'WHATSAPP', idExterno: { not: null } },
      orderBy: { timestamp: 'desc' },
      select: { idExterno: true },
    })
  })
  if (!ultimo?.idExterno) return
  const { enviarCuerpoWhatsapp } = await import('@/modules/connect/whatsapp')
  await enviarCuerpoWhatsapp({
    companyId: input.companyId,
    para: null,
    cuerpo: cuerpoMarcarLeido(ultimo.idExterno),
    registro: null,
  }).catch(() => undefined)
}
