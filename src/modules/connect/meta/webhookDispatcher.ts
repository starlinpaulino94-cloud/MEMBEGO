import 'server-only'
import type { Prisma } from '@prisma/client'
import { sinEmpresa } from '@/lib/tenant'
import { anotarFallo } from '@/lib/prisma-errors'
import { anotarConector } from '@/modules/connect/bitacora'
import { activoPorIdExterno } from '@/modules/connect/meta/activos'
import {
  desglosarNotificacion,
  resumenAnotable,
  type ItemNotificacion,
} from '@/modules/connect/meta/webhookNucleo'
import { encolar } from '@/modules/jobs/cola'

/**
 * EL DESPACHADOR DE WEBHOOKS DE META (Fase 1).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DOS MITADES, Y LA RAYA ENTRE ELLAS ES EL 200
 *
 *   RECIBIR  (dentro de la petición de Meta)
 *     firmar → desglosar → guardar cada item con su clave única → encolar
 *     → responder 200. Rápido y sin tocar a Meta: la ruta corre en Vercel y
 *     Meta reintenta durante 36 horas cualquier cosa que no sea 2xx.
 *
 *   PROCESAR (en la cola, fuera de la petición)
 *     resolver el dueño → manejador por objeto y campo → marcar procesado.
 *     Un fallo aquí se anota en la fila y NO hace que Meta reenvíe: el evento
 *     ya es nuestro y se puede reprocesar desde la base.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A QUÉ EMPRESA PERTENECE
 *
 * Por el activo (`ActivoMeta`, UNIQUE por tipo e id externo): el número o la
 * cuenta de WhatsApp, la Página, la cuenta de Instagram. `findUnique` no
 * puede devolver la fila de otro porque la base impide que exista. Las
 * conexiones de WhatsApp anteriores a esta tabla se resuelven por la clave
 * única que ya tenían, `(conectorId, cuentaExterna)`.
 *
 * Sin dueño no se descarta: se guarda con `companyId` nulo. Meta puede avisar
 * del alta ANTES de que el canje termine, y ese aviso tendrá dueño en unos
 * segundos. Lo que nunca lo tenga se limpia con la retención.
 */

export interface ResultadoRecepcion {
  recibidos: number
  nuevos: number
}

async function resolverDueno(
  item: ItemNotificacion
): Promise<{ companyId: string; activoId: string | null; conexionId: string | null } | null> {
  for (const c of item.candidatos) {
    const activo = await activoPorIdExterno(c.tipo, c.idExterno)
    if (activo) return { companyId: activo.companyId, activoId: activo.id, conexionId: activo.conexionId }
  }

  // Compatibilidad: una conexión de WhatsApp hecha antes de ActivoMeta guarda
  // su WABA en `cuentaExterna`, con UNIQUE por (conector, cuenta).
  if (item.objeto === 'whatsapp_business_account') {
    const conector = await sinEmpresa('meta: webhook — resolver el conector de WhatsApp', (tx) =>
      tx.conector.findUnique({ where: { slug: 'whatsapp' }, select: { id: true } })
    ).catch(() => null)
    if (!conector) return null
    const conexion = await sinEmpresa(
      'meta: webhook — resolver la única conexión dueña de esta cuenta de WhatsApp',
      (tx) =>
        tx.conexionEmpresa.findUnique({
          where: {
            conectorId_cuentaExterna: { conectorId: conector.id, cuentaExterna: item.entryId },
          },
          select: { id: true, companyId: true },
        })
    ).catch(() => null)
    if (conexion) return { companyId: conexion.companyId, activoId: null, conexionId: conexion.id }
  }
  return null
}

/** Mitad 1: guardar y encolar. Nunca lanza; lo que falle queda anotado. */
export async function recibirNotificacion(cuerpo: unknown): Promise<ResultadoRecepcion> {
  const items = desglosarNotificacion(cuerpo)
  let nuevos = 0

  for (const item of items) {
    const dueno = await resolverDueno(item)

    const creado = await sinEmpresa('meta: webhook — guardar un evento crudo con su clave única', (tx) =>
      tx.eventoMeta.createMany({
        data: [
          {
            objeto: item.objeto,
            entryId: item.entryId,
            campo: item.campo,
            claveDedupe: item.claveDedupe,
            companyId: dueno?.companyId ?? null,
            activoId: dueno?.activoId ?? null,
            conexionId: dueno?.conexionId ?? null,
            payload: item.payload as Prisma.InputJsonObject,
            timestampMeta: item.timestamp,
          },
        ],
        // Meta reintentó, o mandó el mismo item en dos lotes: ya lo tenemos.
        skipDuplicates: true,
      })
    ).catch(anotarFallo('meta:webhook-guardar', resumenAnotable(item)))

    if (!creado || creado.count === 0) continue
    nuevos++

    const fila = await sinEmpresa('meta: webhook — id del evento recién guardado', (tx) =>
      tx.eventoMeta.findUnique({ where: { claveDedupe: item.claveDedupe }, select: { id: true } })
    ).catch(() => null)
    if (!fila) continue

    await encolar({ tipo: 'meta-evento', eventoId: fila.id, companyId: dueno?.companyId ?? null }).catch(
      anotarFallo('meta:webhook-encolar', { eventoId: fila.id })
    )
  }

  return { recibidos: items.length, nuevos }
}

// ─── Mitad 2: procesar ───────────────────────────────────────────────────────

export interface EventoMetaFila {
  id: string
  objeto: string
  entryId: string
  campo: string
  companyId: string
  activoId: string | null
  conexionId: string | null
  payload: unknown
  timestampMeta: Date | null
}

/**
 * Un manejador por (objeto, campo). Devuelve un texto corto para el
 * resultado del trabajo. Se cargan con `import()` desde el módulo que los
 * implementa (`mensajeria`), para que `connect` no dependa de él; lo que no
 * tiene manejador deja constancia de que llegó y a quién, sin contenido.
 */
export type ManejadorEvento = (evento: EventoMetaFila) => Promise<string | void>

async function manejadorPara(objeto: string, campo: string): Promise<ManejadorEvento | null> {
  if (objeto === 'whatsapp_business_account') {
    const m = await import('@/modules/mensajeria/manejadoresMeta')
    if (campo === 'messages') return m.entranteWhatsapp
    if (campo === 'statuses') return m.estadoWhatsapp
    if (campo === 'message_template_status_update') return m.plantillaActualizada
  }
  return null
}

async function anotarLlegada(evento: EventoMetaFila): Promise<string> {
  // Del contenido NADA: en el payload viajan teléfonos y textos de clientes
  // finales. Basta con saber que Meta avisó, de qué y sobre qué activo.
  const wabaId = evento.entryId
  await anotarConector({
    companyId: evento.companyId,
    origen: 'CONEXION',
    origenId: evento.conexionId ?? undefined,
    evento: `meta.${evento.campo}`,
    detalle:
      evento.objeto === 'whatsapp_business_account'
        ? { wabaId }
        : { objeto: evento.objeto, entryId: evento.entryId },
  })
  return 'anotado'
}

export interface ResultadoProceso {
  procesados: number
  detalle?: string
}

/** Mitad 2. Idempotente: un evento ya procesado no se vuelve a tocar. */
export async function procesarEventoMeta(eventoId: string): Promise<ResultadoProceso> {
  const ev = await sinEmpresa('meta: cola — leer un evento para procesarlo', (tx) =>
    tx.eventoMeta.findUnique({ where: { id: eventoId } })
  )
  if (!ev) return { procesados: 0, detalle: 'no existe' }
  if (ev.procesadoAt) return { procesados: 0, detalle: 'ya procesado' }

  if (!ev.companyId) {
    // Sin dueño todavía. Se deja SIN procesar para que un reintento posterior
    // (o la reconciliación del alta) lo pueda atribuir; la retención lo
    // limpia si nunca aparece.
    await sinEmpresa('meta: cola — anotar que el evento no tiene dueño', (tx) =>
      tx.eventoMeta.update({ where: { id: ev.id }, data: { error: 'sin_dueño' } })
    )
    return { procesados: 0, detalle: 'sin dueño' }
  }

  const fila: EventoMetaFila = {
    id: ev.id,
    objeto: ev.objeto,
    entryId: ev.entryId,
    campo: ev.campo,
    companyId: ev.companyId,
    activoId: ev.activoId,
    conexionId: ev.conexionId,
    payload: ev.payload,
    timestampMeta: ev.timestampMeta,
  }

  const manejador = (await manejadorPara(ev.objeto, ev.campo)) ?? anotarLlegada
  try {
    const detalle = (await manejador(fila)) ?? undefined
    await sinEmpresa('meta: cola — marcar el evento como procesado', (tx) =>
      tx.eventoMeta.update({ where: { id: ev.id }, data: { procesadoAt: new Date(), error: null } })
    )
    return { procesados: 1, detalle }
  } catch (e) {
    const mensaje = e instanceof Error ? e.message.slice(0, 200) : 'fallo'
    await sinEmpresa('meta: cola — anotar el fallo del manejador', (tx) =>
      tx.eventoMeta.update({ where: { id: ev.id }, data: { error: mensaje } })
    ).catch(() => undefined)
    // Se relanza: la cola reintenta, y si agota, el trabajo queda como difunto
    // en el panel. El evento sigue en la base para reprocesarlo a mano.
    throw e
  }
}
