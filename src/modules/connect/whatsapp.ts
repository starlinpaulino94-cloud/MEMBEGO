import 'server-only'
import { conEmpresa } from '@/lib/tenant'
import { guardarCredencial, leerCredencial } from '@/modules/connect/credenciales'
import { anotarSalud } from '@/modules/connect/registro'
import { anotarConector } from '@/modules/connect/bitacora'
import {
  cuerpoMensajeTexto,
  esCredencialWhatsapp,
  normalizarTelefonoWhatsapp,
  recortarTexto,
  type CredencialWhatsapp,
} from '@/modules/connect/whatsappNucleo'

/**
 * CONECTOR DE WHATSAPP · Meta Cloud API (Membego Connect · Fase 6).
 *
 * Convierte en real la acción `send_whatsapp`, que el motor de
 * automatizaciones lleva desde su primer día registrando como intención
 * simulada («arquitectura futura» en el catálogo de acciones).
 *
 * La credencial es de la EMPRESA, no de MembeGo: cada negocio trae su token
 * permanente y su número. Se guarda cifrada con la clave maestra
 * (`credenciales.ts`) y no vuelve a salir de aquí.
 */

/** Versión de la API de Meta. Se fija: «la última» se rompe sola algún día. */
const VERSION_GRAPH = 'v21.0'
const TIMEOUT_MS = 10_000

export type ResultadoEnvio =
  | { ok: true; mensajeId: string | null }
  | { ok: false; motivo: 'sin_conexion' | 'sin_credencial' | 'telefono_invalido' | 'proveedor'; detalle?: string }

/** La conexión de WhatsApp de una empresa, si está conectada. */
async function conexionWhatsapp(companyId: string): Promise<string | null> {
  const fila = await conEmpresa(companyId, (tx) =>
    tx.conexionEmpresa.findFirst({
      where: { companyId, estado: 'CONNECTED', conector: { slug: 'whatsapp' } },
      select: { id: true },
    })
  ).catch(() => null)
  return fila?.id ?? null
}

/**
 * ¿Puede esta empresa enviar por WhatsApp AHORA?
 *
 * Lo usa el motor de automatizaciones para decidir entre enviar de verdad y
 * seguir registrando la intención. Preguntar antes —en vez de intentar y
 * fallar— es lo que evita que una automatización viva empiece a acumular
 * errores el día que alguien desconecta el número.
 */
export async function whatsappDisponible(companyId: string): Promise<boolean> {
  return (await conexionWhatsapp(companyId)) !== null
}

/**
 * Guarda (o reemplaza) la credencial de WhatsApp de una empresa y comprueba
 * que sirve ANTES de darla por buena.
 *
 * La comprobación no es un lujo: un token mal pegado se descubriría semanas
 * después, cuando una automatización intentara enviar y fallara en silencio.
 * Aquí el error aparece mientras la persona sigue en la pantalla, con el
 * token todavía en el portapapeles.
 */
export async function conectarWhatsapp(input: {
  companyId: string
  conexionId: string
  token: string
  phoneNumberId: string
}): Promise<{ ok: true; numeroVisible: string | null } | { ok: false; detalle: string }> {
  const verificado = await verificarNumero(input.token, input.phoneNumberId)
  if (!verificado.ok) return { ok: false, detalle: verificado.detalle }

  const credencial: CredencialWhatsapp = {
    token: input.token,
    phoneNumberId: input.phoneNumberId,
    numeroVisible: verificado.numeroVisible ?? undefined,
  }
  const guardada = await guardarCredencial({
    companyId: input.companyId,
    conexionId: input.conexionId,
    tipo: 'API_KEY',
    secreto: JSON.stringify(credencial),
    // En metadata solo lo que se puede enseñar sin abrir el sello.
    metadata: { numero: verificado.numeroVisible ?? null },
  })
  if (!guardada.ok) {
    return {
      ok: false,
      detalle:
        guardada.motivo === 'sin_clave_maestra'
          ? 'El almacén de credenciales no está configurado en este despliegue.'
          : 'No se encontró la conexión.',
    }
  }

  await anotarSalud({
    companyId: input.companyId,
    conexionId: input.conexionId,
    resultado: { ok: true },
  })
  await anotarConector({
    companyId: input.companyId,
    origen: 'CONEXION',
    origenId: input.conexionId,
    evento: 'whatsapp.conectado',
  })
  return { ok: true, numeroVisible: verificado.numeroVisible }
}

/**
 * Pregunta a Meta por el número: valida el token Y devuelve el número visible
 * para enseñarlo en el panel. Una sola llamada hace las dos cosas.
 */
async function verificarNumero(
  token: string,
  phoneNumberId: string
): Promise<{ ok: true; numeroVisible: string | null } | { ok: false; detalle: string }> {
  try {
    const resp = await fetch(
      `https://graph.facebook.com/${VERSION_GRAPH}/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) }
    )
    if (!resp.ok) {
      // Los dos fallos que de verdad ocurren, dichos de forma accionable. El
      // cuerpo de Meta NO se enseña: puede traer el propio token en el eco.
      const detalle =
        resp.status === 401 || resp.status === 403
          ? 'Meta rechazó el token. Comprueba que sea un token permanente y que tenga permiso sobre ese número.'
          : resp.status === 404
            ? 'Meta no encontró ese identificador de número. Copia el «Phone number ID», no el número.'
            : `Meta respondió ${resp.status}.`
      return { ok: false, detalle }
    }
    const json = (await resp.json()) as { display_phone_number?: string }
    return { ok: true, numeroVisible: json.display_phone_number ?? null }
  } catch {
    return { ok: false, detalle: 'No se pudo contactar con Meta. Intenta de nuevo.' }
  }
}

/**
 * ENVÍA un mensaje de texto. Best-effort desde fuera: devuelve el motivo en
 * vez de lanzar, porque quien llama es una automatización en vivo.
 *
 * OJO CON LA VENTANA DE 24 HORAS: Meta solo permite texto libre si el cliente
 * escribió al negocio en las últimas 24 h; fuera de esa ventana exige una
 * plantilla aprobada. Cuando eso ocurre, Meta responde con error y aquí queda
 * registrado tal cual — no se disfraza de éxito.
 */
export async function enviarWhatsapp(input: {
  companyId: string
  telefono: string
  texto: string
}): Promise<ResultadoEnvio> {
  const conexionId = await conexionWhatsapp(input.companyId)
  if (!conexionId) return { ok: false, motivo: 'sin_conexion' }

  const guardada = await leerCredencial({
    companyId: input.companyId,
    conexionId,
    tipo: 'API_KEY',
  })
  if (!guardada.ok) return { ok: false, motivo: 'sin_credencial' }

  let credencial: unknown
  try {
    credencial = JSON.parse(guardada.secreto)
  } catch {
    return { ok: false, motivo: 'sin_credencial' }
  }
  if (!esCredencialWhatsapp(credencial)) return { ok: false, motivo: 'sin_credencial' }

  const para = normalizarTelefonoWhatsapp(input.telefono)
  if (!para) return { ok: false, motivo: 'telefono_invalido' }

  try {
    const resp = await fetch(
      `https://graph.facebook.com/${VERSION_GRAPH}/${encodeURIComponent(credencial.phoneNumberId)}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credencial.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(cuerpoMensajeTexto(para, recortarTexto(input.texto))),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }
    )

    if (!resp.ok) {
      // Solo el CÓDIGO de error de Meta, nunca el cuerpo: en sus respuestas de
      // error viaja el `messaging_product` con datos del destinatario.
      const detalle = `Meta respondió ${resp.status}`
      await anotarSalud({
        companyId: input.companyId,
        conexionId,
        resultado: { ok: false, error: detalle },
      })
      return { ok: false, motivo: 'proveedor', detalle }
    }

    const json = (await resp.json().catch(() => ({}))) as {
      messages?: { id?: string }[]
    }
    await anotarSalud({ companyId: input.companyId, conexionId, resultado: { ok: true } })
    return { ok: true, mensajeId: json.messages?.[0]?.id ?? null }
  } catch (e) {
    const detalle = e instanceof Error ? e.message : 'no se pudo contactar con Meta'
    await anotarSalud({
      companyId: input.companyId,
      conexionId,
      resultado: { ok: false, error: detalle },
    })
    return { ok: false, motivo: 'proveedor', detalle }
  }
}
