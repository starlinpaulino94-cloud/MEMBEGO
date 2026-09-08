import 'server-only'
import { conEmpresa } from '@/lib/tenant'
import { anotarFallo } from '@/lib/prisma-errors'
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
 * cliente único de Graph desde Meta · Fase 1; con registro en la
 * conversación desde Meta · Fase 2).
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
 * LO QUE LAS FASES DE META CAMBIARON
 *
 * Las llamadas pasan por `llamarGraph`: UNA versión de Graph para todo el
 * conector (antes v21 aquí y v25 en el alta), `appsecret_proof` en cada
 * llamada, y de un error de Meta se lee solo estado, código y traza — nunca
 * el cuerpo, que trae al destinatario y, en un eco de autorización, el
 * propio token. El número que se conecta a mano queda además reclamado como
 * activo de la empresa, con el mismo UNIQUE que el alta incrustada.
 *
 * Y TODO ENVÍO QUEDA EN SU CONVERSACIÓN: venga de la bandeja o de una
 * automatización, el mensaje se registra en el hilo del contacto con quién
 * lo mandó y de dónde (`mensajeria/salientes`). Best-effort: el envío ya
 * ocurrió, y que el registro falle no lo deshace.
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

export interface CredencialWhatsappViva {
  conexionId: string
  phoneNumberId: string
  /** Solo lo sabe el alta incrustada; el token manual no lo conoce. */
  wabaId: string | null
  token: string
  numeroVisible: string | null
}

/**
 * La credencial abierta de la conexión VIVA de WhatsApp de una empresa, para
 * los módulos de servidor que llaman a Meta con ella (plantillas, marcar
 * como leído). Nunca sale de servidor. Null si no hay conexión o no se pudo
 * abrir el sello.
 */
export async function credencialWhatsappViva(companyId: string): Promise<CredencialWhatsappViva | null> {
  const conexionId = await conexionWhatsapp(companyId)
  if (!conexionId) return null
  const guardada = await leerCredencial({ companyId, conexionId, tipo: 'API_KEY' })
  if (!guardada.ok) return null
  let c: unknown
  try {
    c = JSON.parse(guardada.secreto)
  } catch {
    return null
  }
  if (!esCredencialWhatsapp(c)) return null
  const wabaId = (c as { wabaId?: unknown }).wabaId
  return {
    conexionId,
    phoneNumberId: c.phoneNumberId,
    wabaId: typeof wabaId === 'string' && wabaId ? wabaId : null,
    token: c.token,
    numeroVisible: c.numeroVisible ?? null,
  }
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

// ─── Envío ───────────────────────────────────────────────────────────────────

/** Lo que del envío se registra en la conversación del contacto. */
export interface RegistroEnvio {
  tipo: 'text' | 'template'
  texto: string | null
  plantilla?: Record<string, unknown> | null
  enviadoPorId?: string | null
  /** bandeja | automatizacion | sistema */
  origen?: string | null
}

async function registrarEnConversacion(input: {
  companyId: string
  phoneNumberId: string
  para: string
  registro: RegistroEnvio
  idExterno: string | null
  estado: 'ENVIADO' | 'FALLIDO'
  errorCodigo?: number | null
  errorDetalle?: string | null
}): Promise<void> {
  const { registrarSalienteWhatsapp } = await import('@/modules/mensajeria/salientes')
  await registrarSalienteWhatsapp({
    companyId: input.companyId,
    phoneNumberId: input.phoneNumberId,
    para: input.para,
    tipo: input.registro.tipo,
    texto: input.registro.texto,
    plantilla: input.registro.plantilla ?? null,
    idExterno: input.idExterno,
    estado: input.estado,
    errorCodigo: input.errorCodigo ?? null,
    errorDetalle: input.errorDetalle ?? null,
    enviadoPorId: input.registro.enviadoPorId ?? null,
    origen: input.registro.origen ?? null,
  }).catch(anotarFallo('whatsapp:registrar-saliente'))
}

/**
 * MANDA un cuerpo a `/{phone_number_id}/messages` con la credencial viva de
 * la empresa. Es la única puerta de salida: `enviarWhatsapp` (texto), las
 * plantillas y «marcar como leído» pasan por aquí. Best-effort desde fuera:
 * devuelve el motivo en vez de lanzar, porque quien llama suele ser una
 * automatización en vivo.
 *
 * Con `registro` y `para`, el resultado —bueno o malo— queda en la
 * conversación del destinatario.
 */
export async function enviarCuerpoWhatsapp(input: {
  companyId: string
  /** El wa_id del destinatario, o null si el cuerpo no es un mensaje (marcar leído). */
  para: string | null
  cuerpo: Record<string, unknown>
  registro: RegistroEnvio | null
}): Promise<ResultadoEnvio> {
  const conexionId = await conexionWhatsapp(input.companyId)
  if (!conexionId) return { ok: false, motivo: 'sin_conexion' }

  const guardada = await leerCredencial({ companyId: input.companyId, conexionId, tipo: 'API_KEY' })
  if (!guardada.ok) return { ok: false, motivo: 'sin_credencial' }

  let credencial: unknown
  try {
    credencial = JSON.parse(guardada.secreto)
  } catch {
    return { ok: false, motivo: 'sin_credencial' }
  }
  if (!esCredencialWhatsapp(credencial)) return { ok: false, motivo: 'sin_credencial' }

  const r = await llamarGraph<{ messages?: { id?: string }[] }>({
    ruta: `/${encodeURIComponent(credencial.phoneNumberId)}/messages`,
    metodo: 'POST',
    token: credencial.token,
    cuerpo: input.cuerpo,
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
    if (input.registro && input.para) {
      await registrarEnConversacion({
        companyId: input.companyId,
        phoneNumberId: credencial.phoneNumberId,
        para: input.para,
        registro: input.registro,
        idExterno: null,
        estado: 'FALLIDO',
        errorCodigo: resp.codigo,
        errorDetalle: detalle,
      })
    }
    return { ok: false, motivo: 'proveedor', detalle }
  }

  await anotarSalud({ companyId: input.companyId, conexionId, resultado: { ok: true } })
  const mensajeId = r.datos.messages?.[0]?.id ?? null
  if (input.registro && input.para) {
    await registrarEnConversacion({
      companyId: input.companyId,
      phoneNumberId: credencial.phoneNumberId,
      para: input.para,
      registro: input.registro,
      idExterno: mensajeId,
      estado: 'ENVIADO',
    })
  }
  return { ok: true, mensajeId }
}

/**
 * ENVÍA un mensaje de texto. Best-effort desde fuera: devuelve el motivo en
 * vez de lanzar, porque quien llama es una automatización en vivo.
 *
 * OJO CON LA VENTANA DE 24 HORAS: Meta solo permite texto libre si el cliente
 * escribió al negocio en las últimas 24 h; fuera de esa ventana exige una
 * plantilla aprobada (error 131047). La bandeja lo comprueba antes; una
 * automatización que llegue aquí fuera de ventana recibe el error de Meta
 * tal cual — no se disfraza de éxito.
 */
export async function enviarWhatsapp(input: {
  companyId: string
  telefono: string
  texto: string
  /** Quién y desde dónde, para la conversación. Sin esto: automatización. */
  registro?: { enviadoPorId?: string | null; origen?: string | null }
}): Promise<ResultadoEnvio> {
  const para = normalizarTelefonoWhatsapp(input.telefono)
  if (!para) return { ok: false, motivo: 'telefono_invalido' }
  const texto = recortarTexto(input.texto)

  return enviarCuerpoWhatsapp({
    companyId: input.companyId,
    para,
    cuerpo: cuerpoMensajeTexto(para, texto),
    registro: {
      tipo: 'text',
      texto,
      enviadoPorId: input.registro?.enviadoPorId ?? null,
      origen: input.registro?.origen ?? 'automatizacion',
    },
  })
}
