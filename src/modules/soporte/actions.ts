'use server'

import { revalidatePath } from 'next/cache'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { getUser } from '@/lib/auth'
import { requireAdminUser } from '@/lib/auth/guards'
import { sendEmail } from '@/lib/email'
import { crearDireccionRespuesta } from '@/lib/email/respuestas'
import { escaparHtml } from '@/lib/html'
import { encolarEmail } from '@/modules/jobs/emisiones'
import { crearNotificacion, notificarAdmins } from '@/modules/notificaciones/service'
import {
  normalizarCodigoPais,
  normalizarNumero,
  estadoLabel,
  TICKET_ESTADOS,
} from '@/lib/soporte'
import type { SessionUser } from '@/types'
import { primerErrorZod } from '@/lib/validacion'
import { misClienteIds } from '@/modules/cliente/afiliacion'
import { capturarErrorInesperado } from '@/lib/sentry'
import {
  configComunicacionSchema,
  correoPruebaSchema,
  faqSchema,
  faqActualizarSchema,
  responderTicketSchema,
  notaInternaSchema,
  cambiarEstadoTicketSchema,
  responderClienteSchema,
  crearTicketSchema,
} from '@/modules/soporte/schema'

export interface ActionState {
  error?: string
  success?: boolean
  message?: string
}

const OK: ActionState = { success: true }

/** companyId efectivo para un admin/superadmin a partir del form. */
function resolveCompanyId(user: SessionUser, formData: FormData): string {
  return user.metadata.role === 'SUPERADMIN'
    ? String(formData.get('companyId') ?? '').trim()
    : (user.metadata.companyId ?? '')
}

/** Encuentra el User (para notificar) a partir del supabaseId de un cliente. */
async function findUserIdBySupabase(supabaseId: string): Promise<string | null> {
  const u = await sinEmpresa('soporte: usuario por supabaseId (un usuario puede ser de varias empresas)', (tx) =>
    tx.user.findFirst({
      where: { supabaseId },
      select: { id: true },
    })
  )
  return u?.id ?? null
}

// ── SECCIÓN 1-5: Configuración de Comunicación y Soporte ─────────────────────

export async function guardarComunicacionConfig(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireAdminUser()
  if (!user) return { error: 'No autorizado.' }

  const companyId = resolveCompanyId(user, formData)
  if (!companyId) return { error: 'Selecciona una empresa para guardar la configuración.' }

  const mensajePlantilla = String(formData.get('mensajePlantilla') ?? '').trim()
  const activo = formData.get('activo') !== 'false'
  const horaInicio = String(formData.get('horaInicio') ?? '').trim()
  const horaCierre = String(formData.get('horaCierre') ?? '').trim()
  const diasLaborales = String(formData.get('diasLaborales') ?? '').trim()

  const parsed = configComunicacionSchema.safeParse({
    codigoPais: normalizarCodigoPais(String(formData.get('codigoPais') ?? '')),
    numero: normalizarNumero(String(formData.get('numero') ?? '')),
    correoSoporte: String(formData.get('correoSoporte') ?? ''),
  })
  if (!parsed.success) return { error: primerErrorZod(parsed.error) }
  const { codigoPais, numero, correoSoporte } = parsed.data

  try {
    await conEmpresa(companyId, (tx) =>
      tx.whatsAppConfig.upsert({
        where: { companyId },
        create: {
          companyId,
          codigoPais,
          numero,
          mensajePlantilla: mensajePlantilla || undefined,
          activo,
          correoSoporte: correoSoporte || null,
          horaInicio: horaInicio || null,
          horaCierre: horaCierre || null,
          diasLaborales: diasLaborales || null,
        },
        update: {
          codigoPais,
          numero,
          mensajePlantilla: mensajePlantilla || undefined,
          activo,
          correoSoporte: correoSoporte || null,
          horaInicio: horaInicio || null,
          horaCierre: horaCierre || null,
          diasLaborales: diasLaborales || null,
        },
      })
    )

    revalidatePath('/admin/comunicacion')
    revalidatePath('/cliente/ayuda')
    return OK
  } catch (e) {
    capturarErrorInesperado('soporte:config', e)
    return { error: 'Ocurrió un error. Intenta de nuevo.' }
  }
}

export async function enviarCorreoPrueba(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireAdminUser()
  if (!user) return { error: 'No autorizado.' }

  const parsed = correoPruebaSchema.safeParse({
    correoSoporte: String(formData.get('correoSoporte') ?? ''),
  })
  if (!parsed.success) return { error: primerErrorZod(parsed.error) }
  const { correoSoporte: correo } = parsed.data

  try {
    const result = await sendEmail({
      to: correo,
      subject: 'Correo de prueba · MembeGo',
      html: `<p>Este es un correo de prueba enviado desde el módulo de Comunicación y Soporte de MembeGo.</p>
             <p>Si lo recibes, tu correo de soporte está configurado correctamente.</p>`,
    })

    if (result.sent) {
      return { success: true, message: `Correo de prueba enviado a ${correo}.` }
    }
    return {
      error:
        result.reason === 'RESEND_API_KEY no configurada'
          ? 'No hay proveedor de correo configurado (RESEND_API_KEY). El correo de soporte se guardará, pero el envío automático está deshabilitado.'
          : `No se pudo enviar el correo de prueba: ${result.reason ?? 'error'}.`,
    }
  } catch (e) {
    capturarErrorInesperado('soporte:correo-prueba', e)
    return { error: 'Ocurrió un error al enviar el correo.' }
  }
}

// ── SECCIÓN 6 (admin): FAQ CRUD ──────────────────────────────────────────────

export async function crearFaq(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireAdminUser()
  if (!user) return { error: 'No autorizado.' }
  const companyId = resolveCompanyId(user, formData)
  if (!companyId) return { error: 'Selecciona una empresa.' }

  // XSS protection: pregunta and respuesta are auto-escaped by React JSX
  // when rendered. No additional sanitization needed.
  const parsed = faqSchema.safeParse({
    pregunta: String(formData.get('pregunta') ?? ''),
    respuesta: String(formData.get('respuesta') ?? ''),
    orden: String(formData.get('orden') ?? ''),
  })
  if (!parsed.success) return { error: primerErrorZod(parsed.error) }
  const { pregunta, respuesta, orden } = parsed.data

  try {
    await conEmpresa(companyId, (tx) =>
      tx.faqItem.create({
        data: { companyId, pregunta, respuesta, orden },
      })
    )
    revalidatePath('/admin/comunicacion')
    revalidatePath('/cliente/ayuda')
    return OK
  } catch (e) {
    capturarErrorInesperado('soporte:crear-faq', e)
    return { error: 'Ocurrió un error. Intenta de nuevo.' }
  }
}

export async function actualizarFaq(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireAdminUser()
  if (!user) return { error: 'No autorizado.' }
  const parsed = faqActualizarSchema.safeParse({
    id: String(formData.get('id') ?? ''),
    pregunta: String(formData.get('pregunta') ?? ''),
    respuesta: String(formData.get('respuesta') ?? ''),
    orden: String(formData.get('orden') ?? ''),
  })
  if (!parsed.success) return { error: primerErrorZod(parsed.error) }
  const { id, pregunta, respuesta, orden } = parsed.data

  try {
    const faq = await sinEmpresa('soporte: buscar FAQ por id', (tx) =>
      tx.faqItem.findUnique({ where: { id } })
    )
    if (!faq) return { error: 'Pregunta no encontrada.' }
    if (user.metadata.role !== 'SUPERADMIN' && faq.companyId !== user.metadata.companyId) {
      return { error: 'No autorizado.' }
    }

    await conEmpresa(faq.companyId, (tx) =>
      tx.faqItem.update({
        where: { id },
        data: { pregunta, respuesta, orden },
      })
    )
    revalidatePath('/admin/comunicacion')
    revalidatePath('/cliente/ayuda')
    return OK
  } catch (e) {
    capturarErrorInesperado('soporte:actualizar-faq', e)
    return { error: 'Ocurrió un error. Intenta de nuevo.' }
  }
}

export async function eliminarFaq(id: string): Promise<ActionState> {
  const user = await requireAdminUser()
  if (!user) return { error: 'No autorizado.' }
  try {
    const faq = await sinEmpresa('soporte: buscar FAQ por id', (tx) =>
      tx.faqItem.findUnique({ where: { id } })
    )
    if (!faq) return { error: 'Pregunta no encontrada.' }
    if (user.metadata.role !== 'SUPERADMIN' && faq.companyId !== user.metadata.companyId) {
      return { error: 'No autorizado.' }
    }
    await conEmpresa(faq.companyId, (tx) => tx.faqItem.delete({ where: { id } }))
    revalidatePath('/admin/comunicacion')
    revalidatePath('/cliente/ayuda')
    return OK
  } catch (e) {
    console.error('[soporte]', e)
    return { error: 'Ocurrió un error. Intenta de nuevo.' }
  }
}

export async function toggleFaq(id: string, activo: boolean): Promise<ActionState> {
  const user = await requireAdminUser()
  if (!user) return { error: 'No autorizado.' }
  try {
    const faq = await sinEmpresa('soporte: buscar FAQ por id', (tx) =>
      tx.faqItem.findUnique({ where: { id } })
    )
    if (!faq) return { error: 'Pregunta no encontrada.' }
    if (user.metadata.role !== 'SUPERADMIN' && faq.companyId !== user.metadata.companyId) {
      return { error: 'No autorizado.' }
    }
    await conEmpresa(faq.companyId, (tx) => tx.faqItem.update({ where: { id }, data: { activo } }))
    revalidatePath('/admin/comunicacion')
    revalidatePath('/cliente/ayuda')
    return OK
  } catch (e) {
    console.error('[soporte]', e)
    return { error: 'Ocurrió un error. Intenta de nuevo.' }
  }
}

// ── SECCIÓN 6 (cliente): crear ticket ────────────────────────────────────────

export async function crearTicket(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getUser()
  if (!user || user.metadata.role !== 'CLIENTE') return { error: 'No autorizado.' }

  const clienteId = user.metadata.clienteId
  const companyId = user.metadata.companyId
  if (!clienteId || !companyId) {
    return { error: 'No se pudo identificar tu cuenta de cliente.' }
  }

  const parsed = crearTicketSchema.safeParse({
    asunto: String(formData.get('asunto') ?? ''),
    descripcion: String(formData.get('descripcion') ?? ''),
    categoria: String(formData.get('categoria') ?? 'OTRO'),
    adjuntoUrl: String(formData.get('adjuntoUrl') ?? ''),
  })
  if (!parsed.success) return { error: primerErrorZod(parsed.error) }
  const { asunto, descripcion, categoria, adjuntoUrl } = parsed.data

  try {
    const cliente = await conEmpresa(companyId, (tx) =>
      tx.cliente.findUnique({
        where: { id: clienteId },
        select: { nombre: true },
      })
    )

    const ticket = await conEmpresa(companyId, (tx) =>
      tx.supportTicket.create({
        data: {
          companyId,
          clienteId,
          asunto,
          categoria: categoria as never,
          adjuntoUrl: adjuntoUrl || null,
          mensajes: {
            create: {
              autorTipo: 'CLIENTE',
              autorNombre: cliente?.nombre ?? 'Cliente',
              cuerpo: descripcion,
            },
          },
        },
      })
    )

    await notificarAdmins(companyId, {
      tipo: 'TICKET_NUEVO',
      titulo: 'Nuevo ticket de soporte',
      mensaje: `${cliente?.nombre ?? 'Un cliente'}: ${asunto}`,
      href: `/admin/tickets/${ticket.id}`,
    })

    const config = await conEmpresa(companyId, (tx) =>
      tx.whatsAppConfig.findUnique({
        where: { companyId },
        select: { correoSoporte: true },
      })
    )
    if (config?.correoSoporte) {
      // `Reply-To` firmado: si quien atiende responde desde su gestor de correo
      // —Zoho, Gmail, el que sea—, esa respuesta vuelve al webhook de Resend y
      // entra en este mismo ticket. Sin `EMAIL_REPLY_DOMAIN` configurado,
      // `crearDireccionRespuesta` devuelve null y el correo sale como siempre:
      // la función nueva no puede romper la que ya andaba.
      const replyTo = crearDireccionRespuesta(ticket.id)
      await encolarEmail({
        to: config.correoSoporte,
        subject: `Nuevo ticket: ${asunto}`,
        replyTo,
        // Los tres valores los escribe el cliente. Sin escapar, quien abre un
        // ticket decide el HTML que le llega al buzón del negocio: basta un
        // <a> para que el correo "de soporte" lleve un enlace a otro sitio.
        // El asunto NO se escapa: va en `subject`, que es texto plano; con
        // entidades se leería `&lt;` en la bandeja de entrada.
        //
        // La línea del Reply-To es literal nuestra, sin nada del cliente: no
        // hay nada que escapar en ella.
        html: `<p>Se recibió un nuevo ticket de soporte.</p>
               <p><strong>Cliente:</strong> ${escaparHtml(cliente?.nombre ?? 'Cliente')}<br/>
               <strong>Asunto:</strong> ${escaparHtml(asunto)}<br/>
               <strong>Descripción:</strong> ${escaparHtml(descripcion)}</p>
               ${replyTo ? '<p>Puedes responder a este correo: tu respuesta entra en el ticket.</p>' : ''}`,
      }).catch((e) => {
        console.error('[soporte-email]', e)
      })
    }

    revalidatePath('/cliente/ayuda')
    revalidatePath('/admin/tickets')
    return { success: true, message: 'Ticket enviado. Te avisaremos cuando haya respuesta.' }
  } catch (e) {
    capturarErrorInesperado('soporte:crear-ticket', e)
    return { error: 'Ocurrió un error. Intenta de nuevo.' }
  }
}

// ── SECCIÓN 7 (admin): gestión de tickets ────────────────────────────────────

async function loadTicketForAdmin(user: SessionUser, ticketId: string) {
  const ticket = await sinEmpresa('soporte: buscar ticket por id (se valida la empresa después)', (tx) =>
    tx.supportTicket.findUnique({
      where: { id: ticketId },
      include: { cliente: { select: { supabaseId: true, nombre: true } } },
    })
  )
  if (!ticket) return null
  if (user.metadata.role !== 'SUPERADMIN' && ticket.companyId !== user.metadata.companyId) {
    return null
  }
  return ticket
}

export async function responderTicket(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireAdminUser()
  if (!user) return { error: 'No autorizado.' }

  const parsed = responderTicketSchema.safeParse({
    ticketId: String(formData.get('ticketId') ?? ''),
    cuerpo: String(formData.get('cuerpo') ?? ''),
    nuevoEstado: String(formData.get('estado') ?? ''),
  })
  if (!parsed.success) return { error: primerErrorZod(parsed.error) }
  const { ticketId, cuerpo, nuevoEstado } = parsed.data

  try {
    const ticket = await loadTicketForAdmin(user, ticketId)
    if (!ticket) return { error: 'Ticket no encontrado.' }

    const estado =
      nuevoEstado && (TICKET_ESTADOS as readonly string[]).includes(nuevoEstado)
        ? nuevoEstado
        : 'ESPERANDO_CLIENTE'

    await conEmpresa(ticket.companyId, (tx) =>
      Promise.all([
        tx.ticketMensaje.create({
          data: {
            ticketId,
            autorTipo: 'ADMIN',
            autorNombre: user.email,
            cuerpo,
          },
        }),
        tx.supportTicket.update({
          where: { id: ticketId },
          data: { estado: estado as never },
        }),
      ])
    )

    const clienteUserId = await findUserIdBySupabase(ticket.cliente.supabaseId)
    if (clienteUserId) {
      await crearNotificacion({
        userId: clienteUserId,
        tipo: 'TICKET_RESPUESTA',
        titulo: 'Respuesta a tu ticket',
        mensaje: ticket.asunto,
        href: `/cliente/ayuda/${ticketId}`,
      })
    }

    revalidatePath(`/admin/tickets/${ticketId}`)
    revalidatePath('/admin/tickets')
    revalidatePath(`/cliente/ayuda/${ticketId}`)
    return OK
  } catch (e) {
    capturarErrorInesperado('soporte:responder', e)
    return { error: 'Ocurrió un error. Intenta de nuevo.' }
  }
}

export async function agregarNotaInterna(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireAdminUser()
  if (!user) return { error: 'No autorizado.' }

  const parsed = notaInternaSchema.safeParse({
    ticketId: String(formData.get('ticketId') ?? ''),
    cuerpo: String(formData.get('cuerpo') ?? ''),
  })
  if (!parsed.success) return { error: primerErrorZod(parsed.error) }
  const { ticketId, cuerpo } = parsed.data

  try {
    const ticket = await loadTicketForAdmin(user, ticketId)
    if (!ticket) return { error: 'Ticket no encontrado.' }

    await conEmpresa(ticket.companyId, (tx) =>
      tx.ticketMensaje.create({
        data: {
          ticketId,
          autorTipo: 'ADMIN',
          autorNombre: user.email,
          cuerpo,
          esNotaInterna: true,
        },
      })
    )
    revalidatePath(`/admin/tickets/${ticketId}`)
    return OK
  } catch (e) {
    capturarErrorInesperado('soporte:nota-interna', e)
    return { error: 'Ocurrió un error. Intenta de nuevo.' }
  }
}

export async function cambiarEstadoTicket(
  ticketId: string,
  estado: string
): Promise<ActionState> {
  const user = await requireAdminUser()
  if (!user) return { error: 'No autorizado.' }
  const parsed = cambiarEstadoTicketSchema.safeParse({ estado })
  if (!parsed.success) return { error: primerErrorZod(parsed.error) }
  try {
    const ticket = await loadTicketForAdmin(user, ticketId)
    if (!ticket) return { error: 'Ticket no encontrado.' }

    await conEmpresa(ticket.companyId, (tx) =>
      Promise.all([
        tx.supportTicket.update({
          where: { id: ticketId },
          data: { estado: estado as never },
        }),
        tx.ticketMensaje.create({
          data: {
            ticketId,
            autorTipo: 'SISTEMA',
            autorNombre: 'Sistema',
            cuerpo: `Estado cambiado a "${estadoLabel(estado)}".`,
          },
        }),
      ])
    )

    const clienteUserId = await findUserIdBySupabase(ticket.cliente.supabaseId)
    if (clienteUserId) {
      await crearNotificacion({
        userId: clienteUserId,
        tipo: 'TICKET_ACTUALIZADO',
        titulo: 'Tu ticket cambió de estado',
        mensaje: `${ticket.asunto} → ${estadoLabel(estado)}`,
        href: `/cliente/ayuda/${ticketId}`,
      })
    }

    revalidatePath(`/admin/tickets/${ticketId}`)
    revalidatePath('/admin/tickets')
    return OK
  } catch (e) {
    capturarErrorInesperado('soporte:cambiar-estado', e)
    return { error: 'Ocurrió un error. Intenta de nuevo.' }
  }
}

// ── Cliente responde a su propio ticket ──────────────────────────────────────

export async function responderTicketCliente(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getUser()
  if (!user || user.metadata.role !== 'CLIENTE') return { error: 'No autorizado.' }

  const parsed = responderClienteSchema.safeParse({
    ticketId: String(formData.get('ticketId') ?? ''),
    cuerpo: String(formData.get('cuerpo') ?? ''),
  })
  if (!parsed.success) return { error: primerErrorZod(parsed.error) }
  const { ticketId, cuerpo } = parsed.data

  try {
    const ticket = await sinEmpresa('soporte: buscar ticket por id (se valida el cliente después)', (tx) =>
      tx.supportTicket.findUnique({
        where: { id: ticketId },
        include: { cliente: { select: { id: true, nombre: true } } },
      })
    )
    /**
     * Contra TODAS sus fichas. El listado y el detalle de «Ayuda» enseñan los
     * hilos de todos sus negocios; comprobando aquí la ficha ACTIVA, la caja de
     * respuesta de una conversación abierta contestaba «Ticket no encontrado»
     * sobre un hilo que la persona tenía delante — y con el negocio esperando
     * esa respuesta.
     */
    const misFichas = await misClienteIds(user.supabaseId)
    if (!ticket || !misFichas.includes(ticket.clienteId)) {
      return { error: 'Ticket no encontrado.' }
    }

    await conEmpresa(ticket.companyId, (tx) =>
      Promise.all([
        tx.ticketMensaje.create({
          data: {
            ticketId,
            autorTipo: 'CLIENTE',
            autorNombre: ticket.cliente.nombre,
            cuerpo,
          },
        }),
        tx.supportTicket.update({
          where: { id: ticketId },
          data: { estado: 'EN_PROCESO' },
        }),
      ])
    )

    await notificarAdmins(ticket.companyId, {
      tipo: 'TICKET_ACTUALIZADO',
      titulo: 'Respuesta del cliente en un ticket',
      mensaje: `${ticket.cliente.nombre}: ${ticket.asunto}`,
      href: `/admin/tickets/${ticketId}`,
    })

    revalidatePath(`/cliente/ayuda/${ticketId}`)
    revalidatePath(`/admin/tickets/${ticketId}`)
    return OK
  } catch (e) {
    capturarErrorInesperado('soporte:responder-cliente', e)
    return { error: 'Ocurrió un error. Intenta de nuevo.' }
  }
}
