import 'server-only'
import { conEmpresa } from '@/lib/tenant'
import { Prisma } from '@prisma/client'

/**
 * PROCESAMIENTO DE MENSAJES ENTRANTES DE WHATSAPP → CRM (Fase 2).
 *
 * Wire WhatsApp inbound → Lead + Conversacion + Mensaje. Idempotente:
 * duplicar un msgId no crea registros fantasma.
 *
 * Fire-and-safe: nunca lanza, devuelve el resultado o null implícito.
 */

export interface ResultadoInbound {
  leadId: string
  conversacionId: string
}

/**
 * Procesa un mensaje de texto entrante de WhatsApp y lo wiring al CRM.
 *
 * 1. Upsert Lead por teléfono (uniq company+phone)
 * 2. Find-or-create Conversacion ABIERTA en WHATSAPP
 * 3. Idempotencia: ignorar si msgId ya existe
 * 4. Crear Mensaje ENTRANTE con metadata
 * 5. Actualizar Conversacion (ultimoMensaje, ultimaFecha, noLeidos++)
 */
export async function procesarMensajeEntrante(
  companyId: string,
  telefono: string,
  texto: string,
  msgId: string
): Promise<ResultadoInbound | null> {
  if (!companyId || !telefono || !msgId) return null

  // 1. Upsert Lead — el @@unique ([companyId, telefono]) lo hace idempotente
  const lead = await conEmpresa(companyId, (tx) =>
    tx.lead.upsert({
      where: { Lead_company_telefono: { companyId, telefono } },
      create: {
        companyId,
        nombre: `WhatsApp ${telefono}`,
        telefono,
        canal: 'WHATSAPP',
        fuente: 'WHATSAPP',
      },
      update: {},
      select: { id: true },
    })
  ).catch(() => null)
  if (!lead) return null

  // 2. Buscar conversación ABIERTA o crear una
  let conv = await conEmpresa(companyId, (tx) =>
    tx.conversacion.findFirst({
      where: { leadId: lead.id, canal: 'WHATSAPP', estado: 'ABIERTA' },
      select: { id: true },
    })
  ).catch(() => null)

  if (!conv) {
    conv = await conEmpresa(companyId, (tx) =>
      tx.conversacion.create({
        data: {
          companyId,
          leadId: lead.id,
          canal: 'WHATSAPP',
          estado: 'ABIERTA',
        },
        select: { id: true },
      })
    ).catch(() => null)
  }
  if (!conv) return null

  // 3. Idempotencia: si ya existe un mensaje con ese proveedorMsgId → skip
  const existente = await conEmpresa(companyId, (tx) =>
    tx.mensaje.findFirst({
      where: { conversacionId: conv.id, proveedorMsgId: msgId },
      select: { id: true },
    })
  ).catch(() => null)
  if (existente) return { leadId: lead.id, conversacionId: conv.id }

  // 4. Crear mensaje ENTRANTE
  await conEmpresa(companyId, (tx) =>
    tx.mensaje.create({
      data: {
        conversacionId: conv.id,
        direccion: 'ENTRANTE',
        tipo: 'TEXTO',
        contenido: texto,
        proveedorMsgId: msgId,
        metadata: { whatsapp_from: telefono } as Prisma.InputJsonValue,
        estado: 'ENVIADO',
      },
    })
  ).catch(() => null)

  // 5. Actualizar conversación: último mensaje, fecha, no leídos
  await conEmpresa(companyId, (tx) =>
    tx.conversacion.update({
      where: { id: conv.id },
      data: {
        ultimoMensaje: texto.slice(0, 200),
        ultimaFecha: new Date(),
        noLeidos: { increment: 1 },
      },
    })
  ).catch(() => null)

  return { leadId: lead.id, conversacionId: conv.id }
}
