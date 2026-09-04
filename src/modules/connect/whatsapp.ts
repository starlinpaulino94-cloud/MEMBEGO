import 'server-only'
import { conEmpresa } from '@/lib/tenant'
import { guardarCredencial, leerCredencial } from '@/modules/connect/credenciales'
import { anotarSalud } from '@/modules/connect/registro'
import { anotarConector } from '@/modules/connect/bitacora'
import { claseDeRespuestaGraph, llamarGraph } from '@/modules/connect/meta/graph'
import { reclamarActivo } from '@/modules/connect/meta/activos'
import {
  cuerpoMensajeTexto,
  esCredencialWhatsapp,
  normalizarTelefonoWhatsapp,
  recortarTexto,
  type CredencialWhatsapp,
} from '@/modules/connect/whatsappNucleo'

/**
 * CONECTOR DE WHATSAPP · Meta Cloud API (Membego Connect · Fase 6; sobre el
 * cliente único de Graph desde Meta · Fase 1).
 *
 * Convierte en real la acción `send_whatsapp`, que el motor de
 * automatizaciones lleva desde su primer día registrando como intención
 * simulada («arquitectura futura» en el catálogo de acciones).
 *
 * La credencial es de la EMPRESA, no de MembeGo: cada negocio trae su token
 * permanente y su número. Se guarda cifrada con la clave maestra
 * (`credenciales.ts`) y no vuelve a salir de aquí.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE LA FASE 1 DE META CAMBIÓ
 *
 * Las llamadas pasan por `llamarGraph`: UNA versión de Graph para todo el
 * conector (antes v21 aquí y v25 en el alta), `appsecret_proof` en cada
 * llamada, y de un error de Meta se lee solo estado, código y traza — nunca
 * el cuerpo, que trae al destinatario y, en un eco de autorización, el
 * propio token. El número que se conecta a mano queda además reclamado como
 * activo de la empresa, con el mismo UNIQUE que el alta incrustada.
 */

export type ResultadoEnvio =
  | { ok: true; mensajeId: string | null }
  | {
      ok: false
      motivo: 'sin_conexion' | 'sin_credencial' | 'telefono_invalido' | 'proveedor'
      detalle?: string
    }

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

  // El número es de UNA empresa. Se reclama antes de guardar nada: si otro
  // negocio ya lo tiene, aquí se para y se dice.
  const activo = await reclamarActivo({
    companyId: input.companyId,
    conexionId: input.conexionId,
    tipo: 'PHONE_NUMBER',
    idExterno: input.phoneNumberId,
    nombre: verificado.numeroVisible,
  })
  if (!activo.ok) {
    return {
      ok: false,
      detalle:
        activo.motivo === 'otra_empresa'
          ? 'Ese número ya está conectado a otro negocio en Membego. Desconéctalo allí primero.'
          : 'No se pudo preparar la conexión.',
    }
  }

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
  const r = await llamarGraph<{ display_phone_number?: string }>({
    ruta: `/${encodeURIComponent(phoneNumberId)}`,
    query: { fields: 'display_phone_number,verified_name' },
    token,
  })
  if (!r.ok) {
    const resp = r.respuesta
    if (resp.status === 0) return { ok: false, detalle: 'No se pudo contactar con Meta. Intenta de nuevo.' }
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
  return { ok: true, numeroVisible: r.datos.display_phone_number ?? null }
}

/**
 * ENVÍA un mensaje de texto. Best-effort desde fuera: devuelve el motivo en
 * vez de lanzar, porque quien llama es una automatización en vivo.
 *
 * OJO CON LA VENTANA DE 24 HORAS: Meta solo permite texto libre si el cliente
 * escribió al negocio en las últimas 24 h; fuera de esa ventana exige una
 * plantilla aprobada. Cuando eso ocurre, Meta responde con error y aquí queda
 * registrado tal cual — no se disfraza de éxito. (Las plantillas llegan en la
 * Fase 2 de Meta.)
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

  const r = await llamarGraph<{ messages?: { id?: string }[] }>({
    ruta: `/${encodeURIComponent(credencial.phoneNumberId)}/messages`,
    metodo: 'POST',
    token: credencial.token,
    cuerpo: cuerpoMensajeTexto(para, recortarTexto(input.texto)),
  })

  if (!r.ok) {
    const resp = r.respuesta
    // Solo el ESTADO y la clase, nunca el cuerpo: en sus respuestas de error
    // viaja el `messaging_product` con datos del destinatario.
    const detalle = resp.status === 0 ? 'no se pudo contactar con Meta' : `Meta respondió ${resp.status}`
    await anotarSalud({
      companyId: input.companyId,
      conexionId,
      resultado: { ok: false, error: detalle, clase: claseDeRespuestaGraph(resp) },
    })
    return { ok: false, motivo: 'proveedor', detalle }
  }

  await anotarSalud({ companyId: input.companyId, conexionId, resultado: { ok: true } })
  return { ok: true, mensajeId: r.datos.messages?.[0]?.id ?? null }
}
