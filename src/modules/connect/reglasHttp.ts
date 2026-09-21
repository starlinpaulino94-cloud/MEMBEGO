import 'server-only'
import { conEmpresa } from '@/lib/tenant'
import { anotarFallo } from '@/lib/prisma-errors'
import { ACTION_TYPES } from '@/lib/rule-engine'
import { anotarConector } from '@/modules/connect/bitacora'
import {
  explicarMotivo,
  validarLlamada,
  type MotivoLlamada,
} from '@/modules/connect/llamadaHttpNucleo'

/**
 * REGLAS «cuando pase X, llama a Y» (hallazgo B-1, la pieza que las une).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO EXISTE
 *
 * El webhook entrante mete eventos en el bus. La acción HTTP sabe llamar a
 * cualquier dirección. Las dos están completas y, por separado, no sirven de
 * nada: entre ellas hace falta algo que diga QUÉ evento dispara QUÉ llamada, y
 * hasta ahora las automatizaciones solo se instalaban desde plantillas escritas
 * por nosotros. O sea que ninguna empresa podía escuchar un evento suyo.
 *
 * Esto NO es un constructor de reglas. Es deliberadamente lo más pequeño que
 * cierra el circuito: un evento, una llamada. Sin condiciones, sin pasos
 * encadenados, sin horarios — todo eso ya lo soporta el motor y tendrá su
 * pantalla cuando alguien la necesite. Construir el constructor entero para
 * poder probar el circuito habría sido el orden inverso.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SE ESCRIBE CON `conEmpresa`, NO POR EL REPOSITORIO DEL MOTOR
 *
 * `PrismaAutomationRepository` recibe un `Db` suelto y filtra por `companyId`
 * en sus consultas. Aquí se escribe una fila de una empresa concreta desde una
 * acción del panel, que es exactamente el caso que `lib/tenant` existe para
 * cubrir: el aislamiento no puede depender de que cada `where` se acuerde.
 */

/** Nace PUBLISHED: una regla creada desde el panel y apagada sería una trampa. */
const PUBLICADA = 'PUBLISHED'

/** Marca de las reglas creadas por esta pantalla, para poder listarlas. */
export const CLAVE_REGLA_HTTP = 'connect.llamada_http'

export type ResultadoCrearRegla =
  | { ok: true; id: string }
  | { ok: false; motivo: 'sin_nombre' | 'sin_evento' | 'llamada_invalida'; detalle?: string }

export interface EntradaReglaHttp {
  companyId: string
  nombre: string
  /** El evento que la dispara (`entrante.pedidos`, `cliente.visita`…). */
  evento: string
  metodo: string
  url: string
  cabeceras?: Record<string, string>
  /** Texto libre; suele ser JSON con variables `{{...}}`. */
  cuerpo?: string
}

export async function crearReglaHttp(
  input: EntradaReglaHttp
): Promise<ResultadoCrearRegla> {
  const nombre = input.nombre.trim().slice(0, 120)
  if (!nombre) return { ok: false, motivo: 'sin_nombre' }
  if (!input.evento.trim()) return { ok: false, motivo: 'sin_evento' }

  /**
   * SE VALIDA AL GUARDAR, no solo al ejecutar.
   *
   * El ejecutor vuelve a validar —tiene que hacerlo, porque las variables se
   * interpolan justo antes y la URL final puede no ser la guardada—, pero
   * descubrir que la dirección es inválida en la PRIMERA ejecución significa
   * enterarse cuando el evento ya pasó y no vuelve. Aquí se dice mientras la
   * persona sigue en la pantalla.
   */
  const params = parametrosDeLlamada(input)
  const prueba = validarLlamada(params)
  if (!prueba.ok) {
    return { ok: false, motivo: 'llamada_invalida', detalle: explicarMotivo(prueba.motivo as MotivoLlamada) }
  }

  const fila = await conEmpresa(input.companyId, (tx) =>
    tx.automation.create({
      data: {
        companyId: input.companyId,
        nombre,
        descripcion: `Llama a ${prueba.llamada.url} cuando ocurre ${input.evento}.`,
        templateKey: CLAVE_REGLA_HTTP,
        triggerType: 'EVENT',
        triggerEvent: input.evento.trim(),
        status: PUBLICADA,
        config: {
          trigger: { type: 'EVENT', event: input.evento.trim() },
          steps: [
            {
              label: 'Llamar',
              actions: [{ type: ACTION_TYPES.CALL_HTTP, params, required: true }],
            },
          ],
        } as object,
      },
      select: { id: true },
    })
  ).catch(anotarFallo('connect:regla-http:crear', { evento: input.evento }))

  if (!fila) return { ok: false, motivo: 'llamada_invalida', detalle: 'No se pudo guardar.' }

  await anotarConector({
    companyId: input.companyId,
    origen: 'CONEXION',
    origenId: fila.id,
    evento: 'regla_http.creada',
    // El host y el evento, NO las cabeceras: ahí es donde viaja el
    // `Authorization` del servicio de la empresa.
    detalle: { evento: input.evento.trim(), host: new URL(prueba.llamada.url).hostname },
  })

  return { ok: true, id: fila.id }
}

/** Los `params` de la acción, tal como se guardan en el `config`. */
function parametrosDeLlamada(input: EntradaReglaHttp): Record<string, unknown> {
  return {
    method: input.metodo,
    url: input.url.trim(),
    ...(input.cabeceras && Object.keys(input.cabeceras).length > 0
      ? { headers: input.cabeceras }
      : {}),
    ...(input.cuerpo?.trim() ? { body: input.cuerpo.trim() } : {}),
  }
}

export interface ReglaHttpVista {
  id: string
  nombre: string
  evento: string
  estado: string
  /** Solo el host: la URL entera puede llevar un token en la query. */
  host: string
  createdAt: Date
}

/** Las reglas creadas desde esta pantalla. Las de plantilla no se tocan. */
export async function reglasHttpDeEmpresa(companyId: string): Promise<ReglaHttpVista[]> {
  const filas = await conEmpresa(companyId, (tx) =>
    tx.automation.findMany({
      where: { companyId, templateKey: CLAVE_REGLA_HTTP, status: { not: 'ARCHIVED' } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        nombre: true,
        triggerEvent: true,
        status: true,
        config: true,
        createdAt: true,
      },
    })
  ).catch(() => [])

  return filas.map((f) => ({
    id: f.id,
    nombre: f.nombre,
    evento: f.triggerEvent ?? '—',
    estado: f.status,
    host: hostDeConfig(f.config),
    createdAt: f.createdAt,
  }))
}

/**
 * El host de la llamada, sacado del config. Solo el host, nunca la URL entera:
 * una dirección de webhook lleva a menudo un token en la ruta o en la query, y
 * esta lista se pinta en una pantalla que ve todo el equipo.
 */
function hostDeConfig(config: unknown): string {
  try {
    const pasos = (config as { steps?: { actions?: { params?: { url?: string } }[] }[] }).steps
    const url = pasos?.[0]?.actions?.[0]?.params?.url
    return url ? new URL(url).hostname : '—'
  } catch {
    return '—'
  }
}

/** Pausa o reactiva. PAUSED deja de disparar sin perder la configuración. */
export async function cambiarEstadoRegla(
  companyId: string,
  id: string,
  estado: 'PUBLISHED' | 'PAUSED'
): Promise<{ ok: boolean }> {
  const r = await conEmpresa(companyId, (tx) =>
    tx.automation.updateMany({
      // Acotado también por `templateKey`: esta pantalla no puede tocar una
      // automatización nacida de una plantilla, que tiene otra forma y otro
      // dueño. Un id del formulario no debería poder alcanzarla.
      where: { id, companyId, templateKey: CLAVE_REGLA_HTTP },
      data: { status: estado },
    })
  ).catch(anotarFallo('connect:regla-http:estado', { id }))
  return { ok: (r?.count ?? 0) > 0 }
}

/**
 * ARCHIVA la regla. Deja de dispararse y desaparece de la lista.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO SE BORRA
 *
 * `AutomationRun.automationId` tiene `onDelete: Cascade`, así que un `delete`
 * se llevaría por delante TODAS sus ejecuciones — el registro de qué se llamó,
 * cuándo y con qué resultado. Quien archiva una regla quiere que deje de
 * correr, no perder la prueba de lo que hizo mientras corría; y el día que algo
 * no cuadre, ese historial es lo único que hay.
 *
 * Es la misma regla que el catálogo de conectores («retirar no borra nada»), y
 * por el mismo motivo: en cascada se va mucho más de lo que se pidió.
 *
 * `ARCHIVED` no lo mira `findByEvent`, que solo despacha lo PUBLISHED, así que
 * archivar corta el disparo en la siguiente ejecución.
 */
export async function archivarRegla(companyId: string, id: string): Promise<{ ok: boolean }> {
  const r = await conEmpresa(companyId, (tx) =>
    tx.automation.updateMany({
      where: { id, companyId, templateKey: CLAVE_REGLA_HTTP },
      data: { status: 'ARCHIVED' },
    })
  ).catch(anotarFallo('connect:regla-http:archivar', { id }))

  if ((r?.count ?? 0) > 0) {
    await anotarConector({
      companyId,
      origen: 'CONEXION',
      origenId: id,
      evento: 'regla_http.archivada',
    })
  }
  return { ok: (r?.count ?? 0) > 0 }
}
