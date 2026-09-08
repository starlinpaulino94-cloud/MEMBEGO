import { NextResponse, type NextRequest } from 'next/server'
import { sinEmpresa } from '@/lib/tenant'
import { anotarFallo } from '@/lib/prisma-errors'
import { anotarConector } from '@/modules/connect/bitacora'
import { firmaWebhookValida, respuestaDeVerificacion } from '@/modules/connect/metaNucleo'
import { parsearMensajeWhatsApp, detectarIntencionExcursiones } from '@/modules/connect/whatsappInboundNucleo'
import { buscarAutoReply, buscarBienvenida, enviarAutoReply, resolverUrlCatalogo } from '@/modules/connect/autoReply'
import { procesarMensajeEntrante } from '@/modules/connect/whatsappInbound'
import { enviarWhatsapp } from '@/modules/connect/whatsapp'

export const dynamic = 'force-dynamic'

/**
 * WEBHOOK DE META (Connect · Fase 14).
 *
 * Meta lo exige para el Alta Incrustada: es por donde avisa de que una empresa
 * terminó el alta (`account_update`) y por donde llegarán después los estados
 * de entrega y las respuestas de sus clientes.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PÚBLICA, Y POR ESO NO SE FÍA DE NADA
 *
 * Meta llama sin sesión, así que lo único que separa un aviso legítimo de uno
 * inventado es la FIRMA. Se comprueba antes de mirar el contenido y sobre el
 * cuerpo CRUDO: parsearlo y volver a serializarlo rompería la firma de un
 * aviso bueno por una coma de diferencia.
 *
 * Sin `META_APP_SECRET` la ruta responde 404 y no 500: si el alta incrustada
 * no está configurada aquí, este endpoint no existe para nadie.
 *
 * NO SE HA PROBADO CONTRA META. Escrito contra la documentación pública
 * vigente, sin app con la que ejecutarlo.
 */

/** El apretón de manos de alta de la URL. */
export async function GET(req: NextRequest) {
  const esperado = process.env.META_WEBHOOK_VERIFY_TOKEN ?? ''
  const res = respuestaDeVerificacion(req.nextUrl.searchParams, esperado)
  if (!res.ok) return new NextResponse('Forbidden', { status: 403 })
  // Meta exige el challenge en crudo, no envuelto en JSON.
  return new NextResponse(res.challenge, {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  })
}

interface CambioMeta {
  field?: string
  value?: Record<string, unknown>
}

export async function POST(req: NextRequest) {
  const secreto = process.env.META_APP_SECRET
  if (!secreto) return new NextResponse('Not found', { status: 404 })

  // El cuerpo CRUDO, y una sola vez: `req.text()` no se puede repetir.
  const crudo = await req.text()

  if (!firmaWebhookValida(crudo, req.headers.get('x-hub-signature-256'), secreto)) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  let cuerpo: { entry?: { id?: string; changes?: CambioMeta[] }[] }
  try {
    cuerpo = JSON.parse(crudo)
  } catch {
    // Firmado pero ilegible: se acepta para que Meta no reintente en bucle, y
    // se anota. Devolver error aquí solo produciría más entregas iguales.
    return NextResponse.json({ ok: true })
  }

  // El conector, una sola vez: la clave única es (conectorId, cuentaExterna).
  const conector = await sinEmpresa('connect: webhook de Meta — resolver el conector', (tx) =>
    tx.conector.findUnique({ where: { slug: 'whatsapp' }, select: { id: true } })
  ).catch(anotarFallo('connect:webhook-meta-conector'))
  if (!conector) return NextResponse.json({ ok: true })
  const conectorWhatsapp = conector.id

  for (const entrada of cuerpo.entry ?? []) {
    const wabaId = entrada.id
    if (!wabaId) continue

    const conexion = await sinEmpresa(
      'connect: webhook de Meta — resolver la única conexión dueña de esta cuenta de WhatsApp',
      (tx) =>
        tx.conexionEmpresa.findUnique({
          where: {
            conectorId_cuentaExterna: { conectorId: conectorWhatsapp, cuentaExterna: wabaId },
          },
          select: { id: true, companyId: true },
        })
    ).catch(anotarFallo('connect:webhook-meta-resolver'))

    if (!conexion) continue

    for (const cambio of entrada.changes ?? []) {
      await anotarConector({
        companyId: conexion.companyId,
        origen: 'CONEXION',
        origenId: conexion.id,
        evento: `meta.${cambio.field ?? 'desconocido'}`,
        detalle: { wabaId },
      })
    }

    const parseado = parsearMensajeWhatsApp(entrada)
    if (parseado) {
      for (const msg of parseado.mensajes) {
        const inbound = await procesarMensajeEntrante(
          conexion.companyId,
          msg.from,
          msg.texto,
          msg.msgId
        ).catch((e) => {
          console.error('[connect] webhook: procesarMensajeEntrante falló', e)
          return null
        })

        const autoReply = await buscarAutoReply(conexion.companyId, msg.texto)
        if (autoReply && inbound) {
          await enviarAutoReply(
            conexion.companyId,
            msg.from,
            autoReply.config,
            inbound.conversacionId
          ).catch((e) => {
            console.error('[connect] webhook: enviarAutoReply falló', e)
          })
        } else if (inbound?.esNuevaConversacion) {
          const bienvenida = await buscarBienvenida(conexion.companyId)
          if (bienvenida) {
            await enviarAutoReply(
              conexion.companyId,
              msg.from,
              bienvenida.config,
              inbound.conversacionId
            ).catch((e) => {
              console.error('[connect] webhook: enviarAutoReply (bienvenida) falló', e)
            })
          }
        } else if (detectarIntencionExcursiones(msg.texto)) {
          const urlCatalogo = await resolverUrlCatalogo(conexion.companyId)
          const urlBase =
            process.env.NEXT_PUBLIC_APP_URL ??
            process.env.NEXT_PUBLIC_SITE_URL ??
            'http://127.0.0.1:3000'

          let catalogUrl = urlCatalogo
          if (!catalogUrl) {
            const empresa = await sinEmpresa(
              'webhook: resolver slug de empresa para catálogo',
              (tx) =>
                tx.company.findUnique({
                  where: { id: conexion.companyId },
                  select: { slug: true },
                })
            ).catch(() => null)
            if (empresa?.slug) {
              catalogUrl = `${urlBase}/empresas/${empresa.slug}/excursiones`
            }
          }

          if (catalogUrl) {
            const mensajeCatalogo = `¡Hola! 🌴 Aquí tienes nuestro catálogo de actividades:\n${catalogUrl}\n\n¿Tienes alguna pregunta? Responde aquí y te ayudamos.`

            await enviarWhatsapp({
              companyId: conexion.companyId,
              telefono: msg.from,
              texto: mensajeCatalogo,
            }).catch((e) => {
              console.error('[connect] webhook: enviarWhatsapp auto-reply falló', e)
            })
          }
        }
      }
    }
  }

  // Meta reintenta ante cualquier respuesta que no sea 2xx. Se confirma
  // siempre que la firma cuadre: lo que no sepamos procesar queda en la
  // bitácora, no en una cola de reintentos infinita.
  return NextResponse.json({ ok: true })
}
