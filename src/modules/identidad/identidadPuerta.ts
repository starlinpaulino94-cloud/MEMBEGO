import 'server-only'
import { formSubmitLimiter, identidadSesionLimiter } from '@/lib/rate-limit'
import {
  ErrorDeIdentidad,
  compuertaDeIdentidad,
  estadoDeIdentidadDe,
  consentimientosVigentesDe,
  incidenciasAbiertasDe,
  otorgarConsentimientoIdentidad,
  reportarIncidenciaDePersona,
  revocarConsentimientoIdentidad,
  tieneHistorialDeIdentidad,
} from '@/modules/identidad/identidad'
import { esTipoConsentimientoIdentidad, type TipoConsentimientoIdentidad } from '@/modules/identidad/identidadConsentimientosCore'
import { consultarEstadoConReconciliacion, iniciarSesionDeVerificacion, type OrigenWebDeVerificacion } from '@/modules/identidad/sincronizacion'
import { suprimirIdentidadDePersona } from '@/modules/identidad/supresion'
import { SOPORTE_PLATAFORMA } from '@/lib/soporte'
import { anotarFallo } from '@/lib/prisma-errors'
import { encolarEmail } from '@/modules/jobs/emisiones'
import {
  AVISO_DE_INCIDENCIA,
  MAX_MENSAJE_INCIDENCIA,
  PASOS_DE_VERIFICACION,
  PROVEEDOR_VISIBLE,
  TIPOS_DE_INCIDENCIA,
  URL_CONDICIONES_IDENTIDAD,
  consentimientosParaPantalla,
  construirVista,
  fechaLarga,
  mensajeDeNoPudoEmpezar,
  puntosDePrivacidad,
  type ConsentimientoDePanel,
  type VistaDeIdentidad,
} from '@/modules/identidad/vistaCore'

/**
 * LA PUERTA DE LA PERSONA a su verificación de identidad (Fase 3): lo que comparten
 * la web y la API de la app móvil, para que las dos respondan igual.
 *
 * Es el mismo patrón de `pagos/renovacionPuerta.ts`: las rutas y las acciones solo
 * traducen (saben quién es la persona, sacada SIEMPRE de la sesión, y leen la
 * petición); las reglas viven aquí o en los servicios que esto llama. Nada de lo
 * que entra aquí puede marcar a nadie como verificado: eso solo lo hace el worker
 * tras consultarle al proveedor.
 *
 * Todo lo que sale ya es serializable (sin `Date` ni `Map`) y lleva los textos
 * armados: las pantallas pintan, no deciden.
 */

export interface PanelDeIdentidad {
  /** ¿Se muestra la sección? Con la verificación apagada y sin historial, no: no se anuncia lo que no está disponible. */
  visible: boolean
  vista: VistaDeIdentidad
  /** El intento abierto, si lo hay: a él se refiere una incidencia que la persona reporte desde la pantalla. */
  intentoId: string | null
  consentimientos: ConsentimientoDePanel[]
  pasos: readonly string[]
  privacidad: string[]
  /** El enlace a la política de privacidad, sección de identidad. */
  urlCondiciones: string
  proveedor: string
  tiposDeIncidencia: readonly { valor: string; etiqueta: string }[]
  avisoDeIncidencia: string
  maxMensajeIncidencia: number
  incidenciasAbiertas: { id: string; etiqueta: string; desde: string }[]
  /** El correo y el WhatsApp de soporte de la plataforma, para «contactar» cuando la verificación no puede seguir sola. */
  soporte: { email: string; whatsapp: string }
}

/** Lee todo lo que la pantalla necesita. Con `reconciliar`, antes le pregunta al proveedor si el intento abierto lleva rato sin novedad. */
export async function leerPanelDeIdentidad(userId: string, opciones: { reconciliar?: boolean; ahora?: Date } = {}): Promise<PanelDeIdentidad> {
  const ahora = opciones.ahora ?? new Date()
  const [compuerta, tieneDatos] = await Promise.all([compuertaDeIdentidad(), tieneHistorialDeIdentidad(userId)])
  const visible = compuerta.habilitada || tieneDatos

  const estado = opciones.reconciliar ? await consultarEstadoConReconciliacion(userId, ahora) : await estadoDeIdentidadDe(userId, ahora)
  const consentimientos = consentimientosParaPantalla(await consentimientosVigentesDe(userId))
  const obligatoriosVigentes = consentimientos.filter((c) => c.obligatorio).every((c) => c.vigente)
  let vista = construirVista(estado, { consentimientosObligatoriosVigentes: obligatoriosVigentes, tieneDatos, ahora })

  // Con la verificación apagada se enseña lo que ya existe, pero no se ofrece empezar nada.
  // (Una espera tras un rechazo también se apaga: «podrás intentarlo a las…» sería mentira si no se puede.)
  const ofreceEmpezar = ['verificar', 'continuar', 'reintentar'].includes(vista.accion) || (vista.accion === 'esperar' && !vista.sondear)
  if (!compuerta.habilitada && ofreceEmpezar) {
    vista = {
      ...vista,
      accion: 'ninguna',
      textoAccion: null,
      requiereConsentimientos: false,
      aviso: { tono: 'info', texto: mensajeDeNoPudoEmpezar('no_habilitada') },
    }
  }

  const abiertas = visible ? await incidenciasAbiertasDe(userId) : []
  return {
    visible,
    vista,
    intentoId: estado.intentoAbierto?.id ?? null,
    consentimientos,
    pasos: PASOS_DE_VERIFICACION,
    privacidad: puntosDePrivacidad(),
    urlCondiciones: URL_CONDICIONES_IDENTIDAD,
    proveedor: PROVEEDOR_VISIBLE,
    tiposDeIncidencia: TIPOS_DE_INCIDENCIA,
    avisoDeIncidencia: AVISO_DE_INCIDENCIA,
    maxMensajeIncidencia: MAX_MENSAJE_INCIDENCIA,
    incidenciasAbiertas: abiertas.map((i) => ({
      id: i.id,
      etiqueta: TIPOS_DE_INCIDENCIA.find((t) => t.valor === i.tipo)?.etiqueta ?? 'Problema con la verificación',
      desde: fechaLarga(i.creadaAt),
    })),
    soporte: { email: SOPORTE_PLATAFORMA.email, whatsapp: SOPORTE_PLATAFORMA.whatsappDisplay },
  }
}

// ── Resultados de las acciones ──────────────────────────────────────────────

export type ResultadoDePuerta<T extends object = object> =
  | ({ ok: true } & T)
  | { ok: false; status: 400 | 403 | 404 | 409 | 429 | 500 | 503; error: string; motivo?: string; esperarHasta?: string | null; reintentarEnSegundos?: number | null }

export interface QuienEs {
  /** `User.id`: la persona (nunca de una empresa). */
  userId: string
  supabaseId: string
}

export interface ContextoDePeticion {
  canal: 'web' | 'movil'
  ip?: string | null
  userAgent?: string | null
}

const falla = (status: 400 | 403 | 404 | 409 | 429 | 500 | 503, motivo: string, extra: { esperarHasta?: Date | null; reintentarEnSegundos?: number | null } = {}) =>
  ({
    ok: false as const,
    status,
    motivo,
    error: mensajeDeNoPudoEmpezar(motivo, extra.esperarHasta ?? null),
    esperarHasta: extra.esperarHasta?.toISOString() ?? null,
    reintentarEnSegundos: extra.reintentarEnSegundos ?? null,
  })

/** Acepta los consentimientos marcados: tipo → versión del texto que la persona VIO. Cualquier versión que no sea la vigente se rechaza. */
async function aceptar(userId: string, aceptados: Record<string, string>, ctx: ContextoDePeticion): Promise<'ok' | 'texto_cambio' | 'invalido'> {
  for (const [tipo, version] of Object.entries(aceptados)) {
    if (!esTipoConsentimientoIdentidad(tipo) || typeof version !== 'string') return 'invalido'
    const r = await otorgarConsentimientoIdentidad(userId, tipo, { textoVersionVista: version, canal: ctx.canal, ip: ctx.ip, userAgent: ctx.userAgent })
    if (!r.ok) return r.error === 'texto_cambio' ? 'texto_cambio' : 'invalido'
  }
  return 'ok'
}

/**
 * Empieza (o retoma) la verificación. Si trae `aceptados`, registra ANTES esos consentimientos (cada uno con la
 * versión del texto que la persona vio: si no es la vigente, se rechaza). Después crea la sesión con el proveedor
 * y devuelve la dirección a la que hay que mandarla. NO registrar la respuesta: la dirección lleva un token.
 */
export async function iniciarVerificacionDePersona(
  quien: QuienEs,
  entrada: { aceptados?: Record<string, string>; canalDeCaptura?: 'web' | 'movil_hospedado' | 'movil_nativo'; origenWeb?: OrigenWebDeVerificacion },
  ctx: ContextoDePeticion
): Promise<ResultadoDePuerta<{ url: string; intentoId: string; nonce: string | null }>> {
  if (!(await identidadSesionLimiter(quien.supabaseId))) return falla(429, 'demasiadas_solicitudes')
  if (entrada.aceptados) {
    const r = await aceptar(quien.userId, entrada.aceptados, ctx)
    if (r === 'texto_cambio') return falla(409, 'texto_cambio')
    if (r === 'invalido') return falla(400, 'invalido')
  }
  const canal = entrada.canalDeCaptura ?? (ctx.canal === 'web' ? 'web' : 'movil_hospedado')
  const r = await iniciarSesionDeVerificacion(quien.userId, { canal, ip: ctx.ip, userAgent: ctx.userAgent, origen: entrada.origenWeb })
  if (r.ok) return { ok: true, url: r.url, intentoId: r.intentoId, nonce: r.nonce }
  const extra = { esperarHasta: r.esperarHasta ?? null, reintentarEnSegundos: r.reintentarEnSegundos ?? null }
  if (r.motivo === 'no_habilitada') return falla(403, r.motivo, extra)
  if (r.motivo === 'proveedor_no_disponible' || r.motivo === 'sin_configuracion') return falla(503, r.motivo === 'sin_configuracion' ? 'proveedor_rechazo' : r.motivo, extra)
  if (r.motivo === 'proveedor_rechazo') return falla(503, r.motivo, extra)
  return falla(409, r.motivo, extra)
}

/**
 * Da o retira UN consentimiento (el que se maneja por separado es el de divulgación a los negocios). Retirar el de
 * biometría cancela el intento abierto. Aceptar exige la versión vigente del texto.
 */
export async function cambiarConsentimientoDePersona(
  quien: QuienEs,
  entrada: { tipo: string; accion: 'aceptar' | 'retirar'; version?: string },
  ctx: ContextoDePeticion
): Promise<ResultadoDePuerta> {
  if (!(await formSubmitLimiter(quien.userId))) return falla(429, 'demasiadas_solicitudes')
  if (!esTipoConsentimientoIdentidad(entrada.tipo)) return falla(400, 'invalido')
  const tipo: TipoConsentimientoIdentidad = entrada.tipo
  if (entrada.accion === 'retirar') {
    await revocarConsentimientoIdentidad(quien.userId, tipo)
    return { ok: true }
  }
  const r = await otorgarConsentimientoIdentidad(quien.userId, tipo, {
    textoVersionVista: entrada.version ?? '',
    canal: ctx.canal,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  })
  if (!r.ok) return r.error === 'texto_cambio' ? falla(409, 'texto_cambio') : falla(404, 'persona_no_encontrada')
  return { ok: true }
}

const ERRORES_DE_INCIDENCIA: Record<string, string> = {
  tipo_invalido: 'Elige qué tipo de problema es.',
  mensaje_invalido: 'Cuéntanos qué pasa en pocas palabras (hasta ' + MAX_MENSAJE_INCIDENCIA + ' caracteres).',
  demasiadas_abiertas: 'Ya tienes reportes abiertos. Espera a que los revisemos antes de enviar otro.',
  persona_no_encontrada: 'No pudimos encontrar tu cuenta.',
  intento_ajeno: 'Ese intento no es tuyo.',
}

/**
 * La persona cuenta un problema con su verificación. Queda en la cola del equipo autorizado y se le avisa a soporte de
 * la plataforma por correo, SOLO con el id y el tipo (nunca el texto de la persona: podría traer datos que no debe).
 */
export async function reportarProblemaDePersona(
  quien: QuienEs,
  entrada: { tipo: string; mensaje: string; intentoId?: string | null }
): Promise<ResultadoDePuerta<{ incidenciaId: string }>> {
  if (!(await formSubmitLimiter(quien.userId))) return falla(429, 'demasiadas_solicitudes')
  const r = await reportarIncidenciaDePersona(quien.userId, entrada)
  if (!r.ok) {
    return { ok: false, status: r.error === 'demasiadas_abiertas' ? 429 : 400, motivo: r.error, error: ERRORES_DE_INCIDENCIA[r.error] ?? 'No pudimos registrar tu reporte.' }
  }
  try {
    await encolarEmail({
      to: SOPORTE_PLATAFORMA.email,
      subject: 'Incidencia de verificación de identidad',
      text: `Una persona reportó un problema con su verificación de identidad.\n\nIncidencia: ${r.id}\nTipo: ${entrada.tipo}\n\nRevísala en el panel de administración.`,
      html: `<p>Una persona reportó un problema con su verificación de identidad.</p><p>Incidencia: <strong>${r.id}</strong><br/>Tipo: ${entrada.tipo.replace(/[^a-z_]/g, '')}</p><p>Revísala en el panel de administración.</p>`,
    })
  } catch (e) {
    anotarFallo('identidad:incidencia-correo', { incidencia: r.id })(e)
  }
  return { ok: true, incidenciaId: r.id }
}

/**
 * La persona pide que se borren sus datos de verificación (derecho de supresión). Se atiende en el momento: se borra en el
 * proveedor y, solo si lo confirma, en Membego. Si el proveedor no responde, no se borra nada local y se le dice que vuelva a
 * intentarlo (la solicitud queda registrada).
 */
export async function pedirBorradoDePersona(quien: QuienEs): Promise<ResultadoDePuerta<{ intentosAnonimizados: number }>> {
  if (!(await formSubmitLimiter(quien.userId))) return falla(429, 'demasiadas_solicitudes')
  try {
    const r = await suprimirIdentidadDePersona(null, quien.userId, 'solicitud_de_la_persona')
    return { ok: true, intentosAnonimizados: r.intentosAnonimizados }
  } catch (e) {
    if (e instanceof ErrorDeIdentidad && (e.codigo === 'proveedor_no_disponible' || e.codigo === 'falta_configuracion')) {
      return {
        ok: false,
        status: 503,
        motivo: 'proveedor_no_disponible',
        error: 'No pudimos borrar tus datos en el proveedor en este momento. No se borró nada: vuelve a intentarlo en unos minutos.',
      }
    }
    throw e
  }
}
