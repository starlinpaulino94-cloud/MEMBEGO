import 'server-only'
import { Prisma } from '@prisma/client'
import { conEmpresa } from '@/lib/tenant'
import { anotarFallo } from '@/lib/prisma-errors'
import { llamarGraph } from '@/modules/connect/meta/graph'
import { paginaParaEnviar } from '@/modules/connect/meta/paginas'
import type { EventoMetaFila } from '@/modules/connect/meta/webhookDispatcher'
import { resolverContacto } from '@/modules/mensajeria/contactos'
import { leerEntranteMensajeria, ventanaAbierta, vistaPrevia, type Canal } from '@/modules/mensajeria/nucleo'

/**
 * MESSENGER E INSTAGRAM · entrantes y salientes (Meta · Fases 3 y 4).
 *
 * Los dos usan el formato `messaging` de la Messenger Platform: `sender.id`
 * (PSID / IGSID), `recipient.id` (la Página / la cuenta IG), `timestamp`,
 * `message.mid`, `message.text`, `message.attachments`. Y los dos se envían
 * a `POST /{page-id}/messages` con el token de PÁGINA (documentado para
 * Messenger y para los DM de Instagram, cuyo `recipient.id` es el IGSID),
 * con `messaging_type: RESPONSE` y `message.text`. Para Instagram la Página
 * es la que tiene enlazada la cuenta profesional.
 *
 * La ventana estándar de 24 h aplica igual que en WhatsApp.
 */

function canalDe(objeto: string): Canal {
  return objeto === 'instagram' ? 'INSTAGRAM' : 'MESSENGER'
}

export async function registrarEntranteMensajeria(ev: EventoMetaFila): Promise<string> {
  const m = leerEntranteMensajeria(ev.payload)
  if (!m) return 'ilegible'
  if (!ev.activoId) throw new Error('la Página o cuenta de este evento no está reclamada como activo')
  const canal = canalDe(ev.objeto)

  // Los ecos (mensajes que enviamos nosotros y Meta nos devuelve) no son entrantes.
  if (m.eco) return 'eco'

  const contacto = await resolverContacto({ companyId: ev.companyId, canal, idExterno: m.de })

  const hecho = await conEmpresa(ev.companyId, async (tx) => {
    const conversacion = await tx.conversacion.upsert({
      where: { companyId_activoId_contactoId: { companyId: ev.companyId, activoId: ev.activoId!, contactoId: contacto.id } },
      create: {
        companyId: ev.companyId,
        canal,
        activoId: ev.activoId!,
        contactoId: contacto.id,
        estado: 'ABIERTA',
        ultimoEntranteAt: m.timestamp,
        ultimoMensajeAt: m.timestamp,
        ultimoTexto: vistaPrevia(m.tipo, m.texto),
        noLeidos: 1,
      },
      update: { estado: 'ABIERTA', noLeidos: { increment: 1 } },
      select: { id: true, ultimoEntranteAt: true, ultimoMensajeAt: true },
    })
    const masReciente = !conversacion.ultimoMensajeAt || m.timestamp > conversacion.ultimoMensajeAt
    const entranteMasReciente = !conversacion.ultimoEntranteAt || m.timestamp > conversacion.ultimoEntranteAt
    if (masReciente || entranteMasReciente) {
      await tx.conversacion.update({
        where: { id: conversacion.id },
        data: {
          ...(entranteMasReciente ? { ultimoEntranteAt: m.timestamp } : {}),
          ...(masReciente ? { ultimoMensajeAt: m.timestamp, ultimoTexto: vistaPrevia(m.tipo, m.texto) } : {}),
        },
      })
    }
    try {
      await tx.mensaje.create({
        data: {
          companyId: ev.companyId,
          conversacionId: conversacion.id,
          canal,
          direccion: 'ENTRANTE',
          idExterno: m.idExterno,
          tipo: m.tipo,
          texto: m.texto,
          adjuntos: (m.adjuntos ?? undefined) as Prisma.InputJsonObject | undefined,
          estado: 'RECIBIDO',
          contextoIdExterno: m.contextoIdExterno,
          timestamp: m.timestamp,
        },
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        await tx.conversacion.update({ where: { id: conversacion.id }, data: { noLeidos: { decrement: 1 } } })
        return { r: 'duplicado', conversacionId: conversacion.id }
      }
      throw e
    }
    return { r: `entrante ${m.tipo}`, conversacionId: conversacion.id }
  })

  // Ya guardado: el prospecto y las automatizaciones (nunca lanza). Meta no
  // manda el nombre en `messaging`: el contacto se llama por su rótulo.
  if (hecho.r.startsWith('entrante')) {
    const { trasEntrante } = await import('@/modules/mensajeria/trasEntrante')
    await trasEntrante({
      companyId: ev.companyId,
      canal,
      conversacionId: hecho.conversacionId,
      contacto,
      nombre: null,
      telefono: null,
      tipo: m.tipo,
      texto: m.texto,
      timestamp: m.timestamp,
    })
  }
  return hecho.r
}

/**
 * Entregas y lecturas. ⚠ La forma exacta de `delivery`/`read` (mids,
 * watermark) no se pudo verificar en la documentación durante la auditoría:
 * se aplica lo que venga con `mids` y, si no, nada. Nunca se inventa.
 */
export async function aplicarEstadoMensajeria(ev: EventoMetaFila): Promise<string> {
  const p = ev.payload as { delivery?: { mids?: unknown }; read?: { mids?: unknown } } | null
  const canal = canalDe(ev.objeto)
  const bloque = p?.delivery ?? p?.read
  const nuevo = p?.delivery ? 'ENTREGADO' : p?.read ? 'LEIDO' : null
  const mids = Array.isArray(bloque?.mids) ? bloque.mids.filter((x): x is string => typeof x === 'string') : []
  if (!nuevo || mids.length === 0) return 'sin ids: no se aplica'
  const r = await conEmpresa(ev.companyId, (tx) =>
    tx.mensaje.updateMany({
      where: { companyId: ev.companyId, canal, idExterno: { in: mids }, direccion: 'SALIENTE', estado: { in: nuevo === 'LEIDO' ? ['ENVIANDO', 'ENVIADO', 'ENTREGADO'] : ['ENVIANDO', 'ENVIADO'] } },
      data: { estado: nuevo },
    })
  )
  return `${nuevo}: ${r.count}`
}

export type ResultadoEnvioMensajeria =
  | { ok: true; mensajeId: string | null }
  | { ok: false; motivo: 'no_existe' | 'ventana_cerrada' | 'sin_token' | 'proveedor'; detalle?: string }

/** Texto desde la bandeja por Messenger o Instagram, con el token de Página. */
export async function enviarTextoMensajeria(input: {
  companyId: string
  conversacionId: string
  texto: string
  /** Quién lo envió desde la bandeja; null si fue una automatización. */
  enviadoPorId: string | null
  origen?: 'bandeja' | 'automatizacion'
}): Promise<ResultadoEnvioMensajeria> {
  const c = await conEmpresa(input.companyId, (tx) =>
    tx.conversacion.findFirst({
      where: { id: input.conversacionId, companyId: input.companyId, canal: { in: ['MESSENGER', 'INSTAGRAM'] } },
      select: { id: true, canal: true, activoId: true, ultimoEntranteAt: true, contacto: { select: { idExterno: true } }, activo: { select: { idExterno: true } } },
    })
  )
  if (!c) return { ok: false, motivo: 'no_existe' }
  if (!ventanaAbierta(c.ultimoEntranteAt)) return { ok: false, motivo: 'ventana_cerrada' }
  const pagina = await paginaParaEnviar(input.companyId, c.activoId)
  if (!pagina) return { ok: false, motivo: 'sin_token' }

  const r = await llamarGraph<{ recipient_id?: string; message_id?: string }>({
    ruta: `/${encodeURIComponent(pagina.paginaIdExterno)}/messages`,
    metodo: 'POST',
    token: pagina.token,
    cuerpo: { recipient: { id: c.contacto.idExterno }, messaging_type: 'RESPONSE', message: { text: input.texto } },
  })

  const ahora = new Date()
  const idExterno = r.ok ? r.datos.message_id ?? null : null
  await conEmpresa(input.companyId, async (tx) => {
    await tx.mensaje.create({
      data: {
        companyId: input.companyId,
        conversacionId: c.id,
        canal: c.canal,
        direccion: 'SALIENTE',
        idExterno,
        tipo: 'text',
        texto: input.texto,
        estado: r.ok ? 'ENVIADO' : 'FALLIDO',
        errorCodigo: r.ok ? null : r.respuesta.codigo,
        errorDetalle: r.ok ? null : r.respuesta.status === 0 ? 'no se pudo contactar con Meta' : `Meta respondió ${r.respuesta.status}`,
        enviadoPorId: input.enviadoPorId,
        origen: input.origen ?? 'bandeja',
        timestamp: ahora,
      },
    })
    await tx.conversacion.update({ where: { id: c.id }, data: { ultimoMensajeAt: ahora, ultimoTexto: vistaPrevia('text', input.texto) } })
  }).catch(anotarFallo('mensajeria:registrar-saliente'))

  if (!r.ok) {
    return { ok: false, motivo: 'proveedor', detalle: r.respuesta.status === 0 ? 'no se pudo contactar con Meta' : `Meta respondió ${r.respuesta.status}` }
  }
  return { ok: true, mensajeId: idExterno }
}
