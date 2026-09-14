import { conEmpresa } from '@/lib/tenant'
import {
  enviarTextoEnConversacion,
  type ResultadoEnvioConversacion,
} from '@/modules/mensajeria/salientes'

/**
 * EXCURSIONES · Reservas — confirmación por WhatsApp.
 *
 * El transporte es la capa de salientes de mensajería, la misma de la bandeja
 * y de las automatizaciones: cada envío se persiste como `Mensaje` saliente
 * en la conversación del cliente con `origen: 'automatizacion'`. Aquí no se
 * llama al conector (`connect/whatsapp`) directamente.
 *
 * LA VENTANA MANDA. Texto libre solo dentro de las 24 h desde el último
 * mensaje del cliente; salientes lo comprueba ANTES de llamar a Meta. La
 * confirmación se manda a la conversación WhatsApp abierta del cliente (si la
 * hay); si no hay conversación previa no hay texto libre posible — la vía
 * correcta sería una plantilla aprobada, y el flujo de reservas no tiene una —
 * así que se devuelve `no_existe` sin lanzar: el correo de confirmación (que
 * toda reserva envía) cubre al cliente.
 *
 * ponytail: la capa saliente solo transporta texto/plantillas, no medios, y el
 * conector ya no recibe `imagen` tras el merge, así que el QR que la rama
 * original adjuntaba como imagen no viaja por WhatsApp; el pase (con su QR)
 * llega por correo. Cuando `salientes` transporte medios —o exista una
 * plantilla aprobada de confirmación con el QR como adjunto— se restaura con
 * los mismos datos (`checkinToken`).
 */

type InputConfirmacion = {
  companyId: string
  /** Cliente en la BD de la empresa: su hilo WhatsApp, si existe. */
  clienteId: string
  /** Teléfono del cliente tal como está guardado; respaldo si no hay hilo por clienteId. */
  telefono: string
  numeroReserva: string
  nombreExcursion: string
  fecha: string
  hora: string
  pasajeros: number
  total: number
  moneda: string
}

function construirTextoConfirmacion(i: Omit<InputConfirmacion, 'companyId' | 'clienteId' | 'telefono'>): string {
  return (
    `✅ Reserva confirmada: ${i.numeroReserva}\n` +
    `🎯 ${i.nombreExcursion}\n` +
    `📅 ${i.fecha} a las ${i.hora}\n` +
    `👥 ${i.pasajeros} pasajero(s)\n` +
    `💰 ${i.moneda} ${i.total}\n\n` +
    `Tu pase de acceso está en tu correo. ¡Te esperamos! 🌴`
  )
}

/**
 * Cómo puede estar escrito el wa_id (E.164 sin «+») de un teléfono guardado a
 * mano (con guiones, espacios, código de país o sin él). Es el recorrido
 * inverso de `candidatosTelefono` (nucleo): aquí el dato es local y se busca
 * el id que usa la mensajería.
 */
function waCandidatos(telefono: string): string[] {
  const d = telefono.replace(/\D/g, '')
  if (!d) return []
  const formas = new Set<string>([d])
  if (d.length === 10) {
    formas.add(`1${d}`)
  } else if (d.length === 11 && d.startsWith('1')) {
    formas.add(d.slice(1))
  }
  return [...formas]
}

/** La conversación WhatsApp abierta del cliente, por su ficha o por su número. */
async function conversacionWhatsappDelCliente(
  companyId: string,
  clienteId: string,
  telefono: string
): Promise<{ id: string } | null> {
  return conEmpresa(companyId, async (tx) => {
    if (clienteId) {
      const porFicha = await tx.conversacion.findFirst({
        where: { companyId, canal: 'WHATSAPP', contacto: { clienteId } },
        orderBy: { ultimoMensajeAt: { sort: 'desc', nulls: 'last' } },
        select: { id: true },
      })
      if (porFicha) return porFicha
    }
    const candidatos = waCandidatos(telefono)
    if (candidatos.length === 0) return null
    return tx.conversacion.findFirst({
      where: {
        companyId,
        canal: 'WHATSAPP',
        contacto: { OR: [{ idExterno: { in: candidatos } }, { telefono: { in: candidatos } }] },
      },
      orderBy: { ultimoMensajeAt: { sort: 'desc', nulls: 'last' } },
      select: { id: true },
    })
  })
}

export async function enviarConfirmacionReservaWhatsApp(input: InputConfirmacion): Promise<ResultadoEnvioConversacion> {
  try {
    const texto = construirTextoConfirmacion({
      numeroReserva: input.numeroReserva,
      nombreExcursion: input.nombreExcursion,
      fecha: input.fecha,
      hora: input.hora,
      pasajeros: input.pasajeros,
      total: input.total,
      moneda: input.moneda,
    })

    const conversacion = await conversacionWhatsappDelCliente(input.companyId, input.clienteId, input.telefono)
    if (!conversacion) {
      console.warn(
        `[excursiones] confirmación WhatsApp ${input.numeroReserva}: sin conversación previa con el cliente; va solo por correo.`
      )
      return { ok: false, motivo: 'no_existe', detalle: 'no hay conversación WhatsApp abierta con este cliente' }
    }

    return await enviarTextoEnConversacion({
      companyId: input.companyId,
      conversacionId: conversacion.id,
      texto,
      enviadoPorId: null,
      origen: 'automatizacion',
    })
  } catch (e) {
    console.error('[excursiones] enviarConfirmacionReservaWhatsApp:', e)
    return { ok: false, motivo: 'proveedor', detalle: e instanceof Error ? e.message : 'error desconocido' }
  }
}
