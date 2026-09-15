import 'server-only'
import { conEmpresa } from '@/lib/tenant'
import { firmarHmac } from '@/modules/integraciones/nucleo'
import {
  CABECERA_ENTREGA,
  CABECERA_EVENTO_NOMBRE,
  CABECERA_FIRMA_EMPRESA,
  CABECERA_FIRMA_EMPRESA_V2,
  CABECERA_TIMESTAMP,
  cabeceraDeFirmas,
  materialFirmado,
} from '@membego/contracts'
import { anotarConector } from '@/modules/connect/bitacora'
import {
  diagnosticarParaEmpresa,
  type Diagnostico,
  type RespuestaSonda,
} from '@/modules/integraciones/diagnostico'
import { SELECT_SECRETOS, type SobreWebhook } from '@/modules/connect/webhooks'
import { secretosVivos } from '@/modules/connect/webhooksNucleo'

/**
 * EL REGISTRO DE ENTREGAS de una empresa (hallazgo A-4 de la auditoría).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE ESTO VIENE A ARREGLAR
 *
 * `entregas_webhook` guardaba desde el principio el estado, los intentos, el
 * código HTTP y el error de cada aviso. Ese dato no se enseñaba en NINGUNA
 * pantalla de empresa: su único lector era un `count()` del panel del
 * superadmin. La consecuencia práctica es que «no me llegan los eventos» solo
 * se podía responder abriendo la base de datos — y por tanto era siempre un
 * ticket de soporte, para una pregunta que la propia empresa puede contestarse
 * en diez segundos si se le enseña.
 *
 * Aquí viven las LECTURAS y la SONDA. El reenvío vive en `webhooks.ts`, y la
 * separación no es temática sino por dependencia: reenviar necesita las tripas
 * privadas de la entrega (firmar, entregar, anotar el resultado, programar el
 * siguiente intento) y partirlas en dos módulos habría obligado a exportarlas,
 * que es exactamente como se acaban teniendo dos caminos de entrega.
 */

/** Cuánto del cuerpo de la respuesta se conserva. Lo justo para reconocerla. */
const MAX_CUERPO = 300
const TIMEOUT_SONDA_MS = 10_000

/** Cuántas entregas se enseñan por suscripción. */
export const MAX_ENTREGAS = 50

export interface EntregaVista {
  id: string
  evento: string
  estado: string
  intentos: number
  estadoHttp: number | null
  ultimoError: string | null
  enviadoAt: Date | null
  proximoIntentoAt: Date | null
  createdAt: Date
}

/**
 * Las últimas entregas de UNA suscripción.
 *
 * Sin el `payload`: una lista de cincuenta entregas con su cuerpo entero son
 * cientos de kilobytes que viajan al navegador para que se lean cero. El
 * cuerpo se pide por separado, cuando alguien abre una.
 */
export async function entregasDeSuscripcion(
  companyId: string,
  suscripcionId: string,
  limite = MAX_ENTREGAS
): Promise<EntregaVista[]> {
  return conEmpresa(companyId, (tx) =>
    tx.entregaWebhook.findMany({
      where: { companyId, suscripcionId },
      orderBy: { createdAt: 'desc' },
      take: limite,
      select: {
        id: true,
        evento: true,
        estado: true,
        intentos: true,
        estadoHttp: true,
        ultimoError: true,
        enviadoAt: true,
        proximoIntentoAt: true,
        createdAt: true,
      },
    })
  ).catch(() => [])
}

/** Resumen por estado, para la cabecera. Un `groupBy`, no cincuenta filas. */
export async function resumenDeEntregas(
  companyId: string,
  suscripcionId: string
): Promise<{ enviadas: number; pendientes: number; descartadas: number }> {
  const filas = await conEmpresa(companyId, (tx) =>
    tx.entregaWebhook.groupBy({
      by: ['estado'],
      where: { companyId, suscripcionId },
      _count: { _all: true },
    })
  ).catch(() => [])
  const de = (estado: string) => filas.find((f) => f.estado === estado)?._count._all ?? 0
  return {
    enviadas: de('ENVIADO'),
    pendientes: de('PENDIENTE'),
    descartadas: de('DEAD_LETTER'),
  }
}

/**
 * UNA entrega con el cuerpo EXACTO que se envió.
 *
 * Es la mitad del valor de esta pantalla: sin ver el cuerpo, «tu servidor
 * devolvió 400» no se puede depurar desde ningún lado. El cuerpo es el del
 * evento de esa empresa, así que la consulta va acotada por `companyId` y no
 * por id suelto.
 */
export async function entregaDeEmpresa(
  companyId: string,
  entregaId: string
): Promise<(EntregaVista & { payload: unknown; suscripcionId: string }) | null> {
  return conEmpresa(companyId, (tx) =>
    tx.entregaWebhook.findFirst({
      where: { id: entregaId, companyId },
      select: {
        id: true,
        evento: true,
        estado: true,
        intentos: true,
        estadoHttp: true,
        ultimoError: true,
        enviadoAt: true,
        proximoIntentoAt: true,
        createdAt: true,
        payload: true,
        suscripcionId: true,
      },
    })
  ).catch(() => null)
}

export interface ResultadoPrueba {
  url: string
  get: RespuestaSonda
  post: RespuestaSonda
  diagnostico: Diagnostico
}

/** Toca la URL y traduce lo que pase —incluido no poder conectar— a una respuesta. */
async function tocar(url: string, init: RequestInit): Promise<RespuestaSonda> {
  try {
    const resp = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_SONDA_MS) })
    const cuerpo = await resp.text().catch(() => '')
    return { status: resp.status, cuerpo: cuerpo.slice(0, MAX_CUERPO) }
  } catch (e) {
    return {
      status: 0,
      cuerpo: '',
      error: e instanceof Error ? e.message : 'no se pudo conectar',
    }
  }
}

/**
 * EVENTO DE PRUEBA: manda uno a la URL de la suscripción y dice qué pasó.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA PRUEBA MANDA EXACTAMENTE LA FORMA DE UN AVISO REAL
 *
 * Mismo sobre, mismas cabeceras, misma firma con el mismo secreto. Si mandara
 * una forma simplificada, un servidor podría aceptar la prueba y rechazar los
 * avisos de verdad — que es la peor respuesta posible de un botón de probar:
 * «funciona» cuando no funciona.
 *
 * Lo único distinto es el nombre del evento, `membego.test`, y tiene que serlo:
 * mandar `customer.created` de mentira haría que un servidor bien escrito diera
 * de alta un cliente que no existe. Quien integra debe ignorar ese nombre, y
 * está documentado.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO DEJA FILA EN EL REGISTRO DE ENTREGAS
 *
 * El registro es la historia de lo que le pasó a los eventos DEL NEGOCIO.
 * Meter ahí las pruebas mezclaría dos cosas que se miran por motivos opuestos
 * —una para depurar hoy, la otra para saber si un cobro se avisó— y haría que
 * el contador de descartadas subiera por pruebas. La prueba sí queda anotada,
 * pero en la bitácora, que es donde vive lo que hizo una persona.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL GET NO ES UN CAPRICHO
 *
 * Se tocan las dos: un GET («¿existe esta dirección?») y el POST («¿funciona?»).
 * Cruzarlos es lo que distingue «la ruta no existe» de «la ruta existe y tu
 * código devuelve 404», que se arreglan en sitios distintos y que un 404 a
 * secas confunde. En serie y no en paralelo: si el servidor tiene límite de
 * peticiones, dos a la vez desde la misma IP pueden dar un 429 que ensucie el
 * diagnóstico.
 */
export async function probarSuscripcion(
  companyId: string,
  suscripcionId: string
): Promise<ResultadoPrueba | { error: string }> {
  const sus = await conEmpresa(companyId, (tx) =>
    tx.suscripcionWebhook.findFirst({
      where: { id: suscripcionId, companyId },
      select: { id: true, url: true, estado: true, ...SELECT_SECRETOS },
    })
  ).catch(() => null)

  if (!sus) return { error: 'No encontramos ese webhook.' }

  const sobre: SobreWebhook = {
    id: `test-${Date.now()}`,
    event: 'membego.test',
    companyId,
    createdAt: new Date().toISOString(),
    data: { prueba: true },
  }
  const cuerpo = JSON.stringify(sobre)
  const timestamp = Math.floor(Date.now() / 1000)

  const get = await tocar(sus.url, { method: 'GET' })
  const post = await tocar(sus.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [CABECERA_EVENTO_NOMBRE]: sobre.event,
      [CABECERA_ENTREGA]: sobre.id,
      [CABECERA_TIMESTAMP]: String(timestamp),
      // LAS DOS VERSIONES DE FIRMA, y la v2 con TODOS los secretos vivos —
      // exactamente como una entrega real. Cualquier atajo aquí hace que la
      // prueba mienta, y siempre en la dirección peor:
      //
      //   · solo la v2 → un servidor que aún verifica la v1 la rechaza, y la
      //     pantalla acusa a una integración que funciona;
      //   · solo el secreto vigente → una empresa que acaba de rotar y todavía
      //     no ha copiado el nuevo vería «tu servidor no aceptó nuestra firma»
      //     justo cuando el solape existe para que eso NO pase.
      [CABECERA_FIRMA_EMPRESA_V2]: cabeceraDeFirmas(
        secretosVivos(sus).map((sec) =>
          firmarHmac(sec, materialFirmado(timestamp, sobre.id, cuerpo))
        )
      ),
      [CABECERA_FIRMA_EMPRESA]: firmarHmac(sus.secreto, cuerpo),
    },
    body: cuerpo,
  })

  const diagnostico = diagnosticarParaEmpresa(get, post)

  // Se anota el VEREDICTO, no el cuerpo de la respuesta. El cuerpo de un
  // servidor ajeno puede traer cualquier cosa —una traza con datos de sesión,
  // una página de error con correos dentro— y la bitácora la lee más gente que
  // esta pantalla. El cuerpo crudo se enseña aquí y ahora, y ahí se queda.
  await anotarConector({
    companyId,
    origen: 'CONEXION',
    origenId: sus.id,
    nivel: diagnostico.gravedad === 'ok' ? 'INFO' : 'WARN',
    evento: 'webhook.probado',
    detalle: { status: post.status, titulo: diagnostico.titulo },
  })

  return { url: sus.url, get, post, diagnostico }
}
