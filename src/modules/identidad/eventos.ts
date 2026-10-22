import 'server-only'
import { createHash } from 'node:crypto'
import { getDiditSecretosDeWebhook } from '@/lib/env'
import { anotarFallo, esViolacionUnica } from '@/lib/prisma-errors'
import { sinEmpresa } from '@/lib/tenant'
import {
  ErrorDeIdentidad,
  leerReferenciaDeSesion,
  registrarEventoDescartado,
  ubicarIntento,
} from '@/modules/identidad/identidad'
import { ErrorDeProveedor } from '@/modules/identidad/proveedor/contrato'
import { MAX_BYTES_AVISO, leerAviso, verificarFirmaDeDidit, type AvisoDeProveedor } from '@/modules/identidad/proveedor/diditMapeo'
import { sincronizarIntento } from '@/modules/identidad/sincronizacion'

/**
 * LA BANDEJA DE AVISOS DEL PROVEEDOR (Fase 2): recibir un webhook, registrarlo UNA
 * vez y procesarlo después.
 *
 * El camino de un aviso, en orden y sin saltos:
 *
 *   1. TAMAÑO y PROVEEDOR conocido.
 *   2. FIRMA y frescura, antes de tocar la base de datos y antes de fiarse del cuerpo.
 *   3. FORMA: sin `event_id` y `webhook_type` no se puede registrar con idempotencia.
 *   4. REGISTRO en la bandeja (único por proveedor + `event_id` + tipo). Si no se puede
 *      guardar, se responde 500 para que el proveedor reintente: responder 200 sin
 *      haberlo guardado es perder el aviso.
 *   5. RESPUESTA 200 inmediata (el proveedor corta a los 5 s) y el procesamiento sigue
 *      DESPUÉS de responder. Si falla, el aviso queda pendiente y lo reintenta el barrido.
 *
 * Lo que se guarda de un aviso: id del evento, tipo, estado que decía, id de NUESTRO
 * intento y un hash del cuerpo. Ni el cuerpo ni el id de la sesión.
 */

export const PROVEEDOR_DIDIT = 'didit'
const PROVEEDORES_ACEPTADOS: readonly string[] = [PROVEEDOR_DIDIT]

/** Tipos de aviso que mueven un intento. El resto se registra y se ignora. */
const TIPOS_QUE_PROCESAMOS: readonly string[] = ['status.updated']

/** Tope de reintentos de procesamiento de un mismo aviso. Después queda `fallido` para que lo mire una persona. */
export const MAX_INTENTOS_DE_PROCESO = 8

export interface RespuestaDeAviso {
  status: number
  body: Record<string, unknown>
  /** Lo que sigue DESPUÉS de responder (el endpoint lo programa con `after`). */
  despues?: () => Promise<void>
}

const hashDelCuerpo = (cuerpo: string) => createHash('sha256').update(cuerpo, 'utf8').digest('hex')

/**
 * El manejador de un aviso. Puro respecto del framework: recibe el cuerpo CRUDO (los
 * bytes que llegaron; la firma se calcula sobre ellos, nunca sobre un JSON reserializado)
 * y las cabeceras en minúsculas.
 */
export async function recibirAvisoDeProveedor(entrada: {
  proveedor: string
  cuerpoCrudo: string
  cabeceras: Record<string, string | null | undefined>
  ahora?: Date
}): Promise<RespuestaDeAviso> {
  if (!PROVEEDORES_ACEPTADOS.includes(entrada.proveedor)) return { status: 404, body: { error: 'No encontrado.' } }
  const secretos = getDiditSecretosDeWebhook()
  // Sin secreto no hay con qué autenticar: se responde como si la ruta no existiera.
  if (secretos.length === 0) return { status: 404, body: { error: 'No encontrado.' } }
  if (Buffer.byteLength(entrada.cuerpoCrudo, 'utf8') > MAX_BYTES_AVISO) return { status: 413, body: { error: 'Cuerpo demasiado grande.' } }

  const firma = verificarFirmaDeDidit({ cuerpoCrudo: entrada.cuerpoCrudo, cabeceras: entrada.cabeceras, secretos, ahora: entrada.ahora ?? new Date() })
  if (!firma.ok) {
    anotarFallo('identidad:aviso-rechazado', { codigo: firma.codigo })(new Error(firma.motivo))
    return { status: 401, body: { error: 'No autorizado.' } }
  }

  const aviso = leerAviso(JSON.parse(entrada.cuerpoCrudo))
  if (!aviso) return { status: 400, body: { error: 'Aviso no válido.' } }

  let registrado: { id: string; nuevo: boolean; estado: string }
  try {
    registrado = await registrarEvento(entrada.proveedor, aviso, hashDelCuerpo(entrada.cuerpoCrudo))
  } catch (e) {
    anotarFallo('identidad:aviso-no-guardado')(e)
    return { status: 500, body: { error: 'No se pudo registrar.' } }
  }

  // Un aviso repetido que ya se procesó no hace nada; uno repetido que quedó pendiente se reintenta.
  if (!registrado.nuevo && (registrado.estado === 'procesado' || registrado.estado === 'ignorado')) {
    return { status: 200, body: { ok: true, duplicado: true } }
  }

  // ¿La sesión que nombra el aviso es la de ESE intento? Si no, no se procesa: hay un aviso que no es de él.
  if (registrado.nuevo && aviso.intentoId && aviso.sesionId && (await nombraOtraSesion(aviso))) {
    await cerrarEvento(registrado.id, 'ignorado', 'sesion_no_coincide')
    return { status: 200, body: { ok: true, descartado: true } }
  }

  return {
    status: 200,
    body: { ok: true },
    despues: async () => {
      try {
        await procesarEvento(registrado.id)
      } catch (e) {
        anotarFallo('identidad:aviso-proceso')(e)
      }
    },
  }
}

/** Compara la sesión del aviso con la guardada (sellada) del intento. Solo si el intento ya tiene sesión. */
async function nombraOtraSesion(aviso: AvisoDeProveedor): Promise<boolean> {
  const intento = await ubicarIntento(aviso.intentoId!)
  if (!intento) return false
  if (!intento.tieneSesion) return false // el aviso se adelantó al guardado de la sesión: no hay con qué comparar
  const guardada = await leerReferenciaDeSesion(intento.id)
  if (guardada === null || guardada === aviso.sesionId) return false
  await registrarEventoDescartado(intento.userId, intento.id, 'sesion_no_coincide')
  return true
}

async function registrarEvento(proveedor: string, aviso: AvisoDeProveedor, payloadHash: string): Promise<{ id: string; nuevo: boolean; estado: string }> {
  return sinEmpresa('identidad: la bandeja de avisos del proveedor es de la plataforma', async (tx) => {
    const existente = await tx.identidadEventoExterno.findUnique({
      where: { proveedor_eventoExternoId_tipo: { proveedor, eventoExternoId: aviso.eventoId, tipo: aviso.tipo } },
      select: { id: true, estado: true },
    })
    if (existente) return { id: existente.id, nuevo: false, estado: existente.estado }
    try {
      const creado = await tx.identidadEventoExterno.create({
        data: {
          proveedor,
          eventoExternoId: aviso.eventoId,
          tipo: aviso.tipo,
          estadoExterno: aviso.estado,
          intentoId: aviso.intentoId,
          payloadHash,
        },
        select: { id: true, estado: true },
      })
      return { id: creado.id, nuevo: true, estado: creado.estado }
    } catch (e) {
      // Dos entregas simultáneas del mismo aviso: gana una, la otra lo lee.
      if (!esViolacionUnica(e)) throw e
      const otro = await tx.identidadEventoExterno.findUniqueOrThrow({
        where: { proveedor_eventoExternoId_tipo: { proveedor, eventoExternoId: aviso.eventoId, tipo: aviso.tipo } },
        select: { id: true, estado: true },
      })
      return { id: otro.id, nuevo: false, estado: otro.estado }
    }
  })
}

async function cerrarEvento(id: string, estado: 'procesado' | 'ignorado' | 'fallido', detalle: string | null): Promise<void> {
  await sinEmpresa('identidad: la bandeja de avisos del proveedor es de la plataforma', (tx) =>
    tx.identidadEventoExterno.update({
      where: { id },
      data: { estado, detalle: detalle?.slice(0, 60) ?? null, ...(estado === 'fallido' ? {} : { procesadoAt: new Date() }) },
    })
  )
}

export type ResultadoProcesoDeEvento = 'procesado' | 'ignorado' | 'fallido' | 'no_existe' | 'ya_resuelto' | 'agotado'

/**
 * Procesa un aviso de la bandeja: pregunta al proveedor la verdad sobre el intento
 * y la aplica. Idempotente: un aviso ya resuelto no hace nada. Nunca lanza por un fallo
 * del proveedor: el aviso queda `fallido` con su causa y lo reintenta el barrido.
 */
export async function procesarEvento(eventoId: string): Promise<ResultadoProcesoDeEvento> {
  const evento = await sinEmpresa('identidad: la bandeja de avisos del proveedor es de la plataforma', async (tx) => {
    const e = await tx.identidadEventoExterno.findUnique({ where: { id: eventoId } })
    if (!e || e.estado === 'procesado' || e.estado === 'ignorado') return e
    // Se cuenta el intento ANTES de procesar: un aviso que hace caer al proceso no se reintenta eternamente.
    await tx.identidadEventoExterno.update({ where: { id: eventoId }, data: { intentosDeProceso: { increment: 1 } } })
    return { ...e, intentosDeProceso: e.intentosDeProceso + 1 }
  })
  if (!evento) return 'no_existe'
  if (evento.estado === 'procesado' || evento.estado === 'ignorado') return 'ya_resuelto'
  if (evento.intentosDeProceso > MAX_INTENTOS_DE_PROCESO) {
    await cerrarEvento(eventoId, 'fallido', 'reintentos_agotados')
    return 'agotado'
  }

  if (!TIPOS_QUE_PROCESAMOS.includes(evento.tipo)) {
    await cerrarEvento(eventoId, 'ignorado', 'tipo_no_relevante')
    return 'ignorado'
  }
  if (!evento.intentoId) {
    await cerrarEvento(eventoId, 'ignorado', 'sin_referencia')
    return 'ignorado'
  }

  try {
    const r = await sincronizarIntento(evento.intentoId)
    if (r.resultado === 'no_existe') {
      await cerrarEvento(eventoId, 'ignorado', 'intento_desconocido')
      return 'ignorado'
    }
    if (r.resultado === 'descartado') {
      await cerrarEvento(eventoId, 'ignorado', 'referencia_no_coincide')
      return 'ignorado'
    }
    if (r.resultado === 'sin_sesion') {
      // El aviso llegó antes de que guardáramos la sesión: se reintenta cuando ya esté.
      await cerrarEvento(eventoId, 'fallido', 'sin_sesion_aun')
      return 'fallido'
    }
    await cerrarEvento(eventoId, 'procesado', null)
    return 'procesado'
  } catch (e) {
    const detalle =
      e instanceof ErrorDeProveedor ? (e.reintentable ? 'proveedor_no_disponible' : 'error_proveedor') : e instanceof ErrorDeIdentidad ? e.codigo : 'error_interno'
    anotarFallo('identidad:procesar-evento', { detalle })(e)
    await cerrarEvento(eventoId, 'fallido', detalle)
    return 'fallido'
  }
}

/**
 * Reintenta los avisos pendientes (los que no se pudieron procesar al llegar). Un aviso
 * recién llegado se deja un minuto: su procesamiento inmediato todavía puede estar en curso.
 */
export async function reintentarEventosPendientes(
  opciones: { ahora?: Date; limite?: number; presupuestoMs?: number } = {}
): Promise<{ intentados: number; procesados: number }> {
  const ahora = opciones.ahora ?? new Date()
  const termina = Date.now() + (opciones.presupuestoMs ?? 30_000)
  const pendientes = await sinEmpresa('identidad: el barrido recorre la bandeja de avisos', (tx) =>
    tx.identidadEventoExterno.findMany({
      where: {
        estado: { in: ['recibido', 'fallido'] },
        intentosDeProceso: { lt: MAX_INTENTOS_DE_PROCESO },
        recibidoAt: { lt: new Date(ahora.getTime() - 60_000) },
      },
      select: { id: true },
      orderBy: { recibidoAt: 'asc' },
      take: opciones.limite ?? 50,
    })
  )
  let procesados = 0
  let intentados = 0
  for (const { id } of pendientes) {
    if (Date.now() > termina) break
    intentados++
    if ((await procesarEvento(id)) === 'procesado') procesados++
  }
  return { intentados, procesados }
}
