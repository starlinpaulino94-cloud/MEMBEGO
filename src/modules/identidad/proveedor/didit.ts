import 'server-only'
import { getDiditConfig } from '@/lib/env'
import { Circuito } from '@/modules/identidad/proveedor/circuito'
import {
  ErrorDeProveedor,
  type DecisionDelProveedor,
  type ProveedorDeIdentidad,
  type SesionCreada,
} from '@/modules/identidad/proveedor/contrato'
import { traducirDecisionDeDidit } from '@/modules/identidad/proveedor/diditMapeo'

/**
 * EL CLIENTE HTTP DE DIDIT (Fase 2). Solo el SERVIDOR lo usa: la clave
 * (`x-api-key`) nunca llega a un navegador, a la app ni a un log.
 *
 * Reglas de este archivo:
 *  · SIN REDIRECCIONES (`redirect: 'manual'`): una 3xx es un fallo, no se sigue (SSRF).
 *  · TIEMPO MÁXIMO por llamada, y un INTERRUPTOR AUTOMÁTICO: si Didit se cae, se deja
 *    de llamarle un rato en vez de acumular esperas.
 *  · NINGÚN MENSAJE DE ERROR lleva cuerpo de respuesta ni la URL de la sesión (lleva
 *    un token): solo la operación y el estado HTTP.
 *  · lo que se devuelve ya está traducido al vocabulario de MEMBEGO.
 *
 * Endpoints (docs.didit.me, 22-oct-2026):
 *   POST   /v3/session/                     crear (idempotente por `vendor_data`)
 *   GET    /v3/session/{id}/decision/       decisión vigente
 *   DELETE /v3/session/{id}/delete/         borrar sesión (+ plantillas si `privacy_erasure`)
 *   POST   /v3/users/delete/                borrar entidades de persona por `vendor_data_list`
 */

const TIEMPO_MAXIMO_MS = 8_000
const SESION_ID = /^[0-9a-fA-F-]{16,64}$/

/** El interruptor compartido por todas las llamadas de esta instancia. */
const circuitoGlobal = new Circuito()

export interface OpcionesDeDidit {
  /** Para probar sin red. */
  fetchFn?: typeof fetch
  circuito?: Circuito
  tiempoMaximoMs?: number
}

export function crearProveedorDidit(
  config: { apiKey: string; workflowId: string; apiBase: string },
  opciones: OpcionesDeDidit = {}
): ProveedorDeIdentidad {
  const hacerFetch = opciones.fetchFn ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
  const circuito = opciones.circuito ?? circuitoGlobal
  const tiempo = opciones.tiempoMaximoMs ?? TIEMPO_MAXIMO_MS

  /** Una llamada. Devuelve el estado y el JSON (o null si no hay cuerpo). */
  async function llamar(
    operacion: string,
    metodo: 'GET' | 'POST' | 'DELETE',
    ruta: string,
    cuerpo?: unknown
  ): Promise<{ estado: number; json: unknown }> {
    if (!circuito.puedeLlamar()) {
      throw new ErrorDeProveedor('circuito_abierto', `El proveedor está fallando: ${operacion} se pospone.`)
    }
    let resp: Response
    try {
      resp = await hacerFetch(`${config.apiBase}${ruta}`, {
        method: metodo,
        headers: {
          'x-api-key': config.apiKey,
          Accept: 'application/json',
          ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
        redirect: 'manual',
        signal: AbortSignal.timeout(tiempo),
      })
    } catch {
      circuito.registrarFallo()
      throw new ErrorDeProveedor('no_disponible', `No se pudo hablar con el proveedor (${operacion}).`)
    }

    if (resp.status >= 500 || resp.status === 429) {
      circuito.registrarFallo()
      throw new ErrorDeProveedor('no_disponible', `El proveedor respondió ${resp.status} (${operacion}).`, resp.status)
    }
    // Llegó una respuesta de verdad: el proveedor está vivo aunque nos diga que no.
    circuito.registrarExito()

    const texto = await resp.text().catch(() => '')
    let json: unknown = null
    if (texto) {
      try {
        json = JSON.parse(texto)
      } catch {
        json = null
      }
    }
    if (resp.status >= 300 && resp.status < 400) {
      throw new ErrorDeProveedor('rechazado', `El proveedor redirige (${resp.status}, ${operacion}); no se sigue.`, resp.status)
    }
    return { estado: resp.status, json }
  }

  const idSeguro = (id: string) => {
    if (!SESION_ID.test(id)) throw new ErrorDeProveedor('respuesta_invalida', 'El id de la sesión no tiene forma de id.')
    return encodeURIComponent(id)
  }

  return {
    nombre: 'didit',

    async crearSesion(entrada): Promise<SesionCreada> {
      const { estado, json } = await llamar('crear sesión', 'POST', '/v3/session/', {
        workflow_id: config.workflowId,
        // Nuestra referencia: es el id del INTENTO, que no identifica a nadie fuera de MEMBEGO.
        // También es la clave de idempotencia: la misma referencia devuelve la sesión sin terminar.
        vendor_data: entrada.intentoId,
        callback: entrada.callbackUrl,
        language: entrada.idioma,
      })
      if (estado !== 200 && estado !== 201) {
        throw new ErrorDeProveedor('rechazado', `El proveedor no creó la sesión (${estado}).`, estado)
      }
      const o = json && typeof json === 'object' ? (json as Record<string, unknown>) : null
      const sesionId = typeof o?.session_id === 'string' ? o.session_id : null
      const url = typeof o?.url === 'string' ? o.url : null
      if (!sesionId || !SESION_ID.test(sesionId) || !url) {
        throw new ErrorDeProveedor('respuesta_invalida', 'La respuesta de crear sesión no trae id y dirección.')
      }
      // La dirección a la que se manda a la persona tiene que ser del proveedor, por https.
      let destino: URL
      try {
        destino = new URL(url)
      } catch {
        throw new ErrorDeProveedor('respuesta_invalida', 'La dirección de la sesión no es válida.')
      }
      if (destino.protocol !== 'https:' || !/(^|\.)didit\.me$/i.test(destino.hostname)) {
        throw new ErrorDeProveedor('respuesta_invalida', 'La dirección de la sesión no es del proveedor.')
      }
      return { sesionId, url: destino.toString() }
    },

    async consultarDecision(sesionId): Promise<DecisionDelProveedor> {
      const { estado, json } = await llamar('consultar decisión', 'GET', `/v3/session/${idSeguro(sesionId)}/decision/`)
      if (estado === 404) throw new ErrorDeProveedor('rechazado', 'El proveedor no conoce la sesión.', 404)
      if (estado !== 200) throw new ErrorDeProveedor('rechazado', `El proveedor no dio la decisión (${estado}).`, estado)
      return traducirDecisionDeDidit(json)
    },

    async borrarSesion(sesionId, opciones): Promise<'borrada' | 'ya_borrada'> {
      const { estado } = await llamar('borrar sesión', 'DELETE', `/v3/session/${idSeguro(sesionId)}/delete/`, {
        deletion_instruction: opciones.motivo === 'supresion' ? 'privacy_erasure' : 'operational_session_delete',
        // Sin plantillas faciales retenidas: «procesar y purgar».
        retain_face_embeddings: false,
        instruction_id: opciones.instruccionId.slice(0, 255),
      })
      if (estado === 404) return 'ya_borrada'
      if (estado === 200 || estado === 204) return 'borrada'
      throw new ErrorDeProveedor('rechazado', `El proveedor no borró la sesión (${estado}).`, estado)
    },

    async borrarUsuarios(referencias): Promise<void> {
      if (referencias.length === 0) return
      const { estado } = await llamar('borrar personas', 'POST', '/v3/users/delete/', { vendor_data_list: [...referencias] })
      if (estado === 404) return
      if (estado < 200 || estado >= 300) {
        throw new ErrorDeProveedor('rechazado', `El proveedor no borró las personas (${estado}).`, estado)
      }
    },
  }
}

/** El proveedor configurado, o lanza `no_configurado`. */
export function proveedorDeIdentidad(): ProveedorDeIdentidad {
  const config = getDiditConfig()
  if (!config) throw new ErrorDeProveedor('no_configurado', 'Falta configurar el proveedor de verificación.')
  return crearProveedorDidit(config)
}
