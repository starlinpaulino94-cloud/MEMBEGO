import 'server-only'
import {
  MAX_RESPUESTA,
  TIMEOUT_MS,
  explicarMotivo,
  validarLlamada,
} from '@/modules/connect/llamadaHttpNucleo'

/**
 * LA ACCIÓN HTTP A MEDIDA (hallazgo B-1, segunda mitad): que una automatización
 * pueda llamar a cualquier dirección.
 *
 * Es la contraparte del webhook entrante. Aquél deja que una herramienta ajena
 * nos avise; ésta deja que nosotros avisemos a cualquier herramienta, con el
 * método, las cabeceras y el cuerpo que decida quien configuró la regla. Con
 * las dos, conectar MembeGo con algo que no hemos integrado a mano deja de
 * requerir que lo integremos a mano.
 */

export interface ResultadoLlamada {
  ok: boolean
  status: number | null
  /** Trozo de la respuesta, para que quien configuró pueda depurar. */
  respuesta: string | null
  error: string | null
}

/**
 * Ejecuta la llamada descrita por los parámetros de la acción.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SIN REDIRECCIONES, Y ESTO NO ES UN DETALLE
 *
 * `fetch` sigue redirecciones por defecto. Con eso, toda la validación de la
 * URL se puede saltar en un paso: basta con que quien configura ponga un
 * dominio público perfectamente válido que responda `302` hacia
 * `http://169.254.169.254/` —el servicio de metadatos de la nube— para que
 * nuestro servidor vaya, desde dentro, a leer credenciales de infraestructura y
 * se las devuelva en el cuerpo de la respuesta guardada.
 *
 * Es la familia de fallos SSRF, y la guardia de la URL no la cubre porque solo
 * ve la PRIMERA dirección. `redirect: 'manual'` la cierra: un 3xx se trata como
 * el resultado y no se sigue. Quien de verdad necesite seguir una redirección
 * pone la dirección final, que además es lo que querría en un webhook.
 */
export async function ejecutarLlamadaHttp(
  params: Record<string, unknown>
): Promise<ResultadoLlamada> {
  const validada = validarLlamada(params)
  if (!validada.ok) {
    return { ok: false, status: null, respuesta: null, error: explicarMotivo(validada.motivo) }
  }
  const { metodo, url, cabeceras, cuerpo } = validada.llamada

  try {
    const resp = await fetch(url, {
      method: metodo,
      headers: {
        // El `Content-Type` va primero para que una cabecera a medida pueda
        // cambiarlo: quien manda `application/x-www-form-urlencoded` sabe lo
        // que hace, y forzarle JSON le rompería la integración.
        ...(cuerpo !== null ? { 'Content-Type': 'application/json' } : {}),
        ...cabeceras,
      },
      body: cuerpo ?? undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    // Un 3xx con `redirect: 'manual'` llega aquí como respuesta normal. Se
    // trata como fallo y se DICE que fue una redirección: si se contara como
    // éxito, quien configuró creería que su aviso llegó a alguna parte.
    if (resp.status >= 300 && resp.status < 400) {
      return {
        ok: false,
        status: resp.status,
        respuesta: null,
        error: `La dirección redirige (HTTP ${resp.status}). No seguimos redirecciones: pon la dirección final.`,
      }
    }

    const texto = (await resp.text().catch(() => '')).trim().replace(/\s+/g, ' ')
    const respuesta = texto ? texto.slice(0, MAX_RESPUESTA) : null
    if (resp.ok) return { ok: true, status: resp.status, respuesta, error: null }
    return {
      ok: false,
      status: resp.status,
      respuesta,
      error: `HTTP ${resp.status}`,
    }
  } catch (e) {
    return {
      ok: false,
      status: null,
      respuesta: null,
      error: e instanceof Error ? e.message : 'no se pudo conectar',
    }
  }
}
