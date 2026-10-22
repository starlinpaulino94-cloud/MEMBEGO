import { createHmac } from 'node:crypto'

/**
 * NÚCLEO PURO de la verificación de identidad.
 *
 * Sin Prisma, sin red y sin `process.env`: todo lo que decide —qué transición de
 * estado es legal, cuándo se puede reintentar, qué se le dice a la persona, cuándo
 * caduca— se prueba con datos sueltos. El uso con base de datos vive en
 * `identidad.ts`.
 *
 * Fuente de verdad del diseño: docs/identidad/AUDITORIA-VERIFICACION-IDENTIDAD.md.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LAS TRES REGLAS QUE ESTE MÓDULO EXISTE PARA SOSTENER
 *
 *  1. EL CLIENTE NUNCA SE MARCA VERIFICADO. Aquí no hay función que convierta un
 *     «dime que sí» en `verificada`: el estado lo escribe solo el worker, tras
 *     re-consultar la decisión al proveedor.
 *  2. LOS ESTADOS SOLO AVANZAN. Los webhooks no llegan en orden (ni lo garantiza
 *     ningún proveedor): un «en proceso» tardío no puede deshacer un «aprobada», y
 *     una decisión final no la cambia otra distinta sin que una persona lo vea.
 *  3. MEMBEGO ESCRIBE LOS MENSAJES. Al usuario se le dice lo que MEMBEGO decide
 *     decir, mapeado desde un catálogo propio de códigos; jamás el texto del
 *     proveedor ni una pista de qué señal de fraude saltó.
 */

// ── Vocabulario ─────────────────────────────────────────────────────────────

export const ESTADOS_VERIFICACION = [
  'no_verificada',
  'verificada',
  'expirada',
  'revocada',
  'requiere_revalidacion',
] as const
export type EstadoVerificacion = (typeof ESTADOS_VERIFICACION)[number]

export const NIVELES_IDENTIDAD = ['contacto', 'documento_selfie', 'jce_oficial'] as const
export type NivelIdentidad = (typeof NIVELES_IDENTIDAD)[number]

/** La vía seguida (NIST SP 800-63A-4 §4.2 pide registrarla). */
export const VIAS_VERIFICACION = ['proveedor_documento_selfie', 'jce_oficial', 'revision_manual'] as const
export type ViaVerificacion = (typeof VIAS_VERIFICACION)[number]

export const ESTADOS_INTENTO = [
  'creada',
  'iniciada',
  'enviada',
  'en_proceso',
  'aprobada',
  'rechazada_reintentable',
  'rechazada_definitiva',
  'reenvio_requerido',
  'en_revision',
  'expirada',
  'abandonada',
  'cancelada',
] as const
export type EstadoIntento = (typeof ESTADOS_INTENTO)[number]

/**
 * Los estados en los que el intento SIGUE ABIERTO: hay una sesión viva o un
 * caso esperando a una persona. Un índice único parcial en la base (misma lista)
 * impide que una persona tenga dos a la vez.
 */
export const ESTADOS_INTENTO_ABIERTOS: readonly EstadoIntento[] = [
  'creada',
  'iniciada',
  'enviada',
  'en_proceso',
  'reenvio_requerido',
  'en_revision',
]

export const ESTADOS_INTENTO_FINALES: readonly EstadoIntento[] = [
  'aprobada',
  'rechazada_reintentable',
  'rechazada_definitiva',
  'expirada',
  'abandonada',
  'cancelada',
]

export const CANALES_INTENTO = ['web', 'movil_hospedado', 'movil_nativo'] as const
export type CanalIntento = (typeof CANALES_INTENTO)[number]

export const ORIGENES_INTENTO = ['cliente', 'staff', 'sistema'] as const
export type OrigenIntento = (typeof ORIGENES_INTENTO)[number]

export const TIPOS_RECHAZO = ['reintentable', 'definitivo'] as const
export type TipoRechazo = (typeof TIPOS_RECHAZO)[number]

export function esEstadoAbierto(estado: string): boolean {
  return (ESTADOS_INTENTO_ABIERTOS as readonly string[]).includes(estado)
}

export function esEstadoFinal(estado: string): boolean {
  return (ESTADOS_INTENTO_FINALES as readonly string[]).includes(estado)
}

// ── La política (todas las cifras, en UN objeto) ────────────────────────────

/**
 * Las cifras de la política de identidad. Si cambia una y la política pública
 * dice otra, `tests/identidad-consentimientos.test.ts` lo detecta para el plazo de
 * los textos de consentimiento (la sección de `/privacy` llega con la Fase 3 y
 * entrará en esa misma prueba): el usuario aceptó una cosa y el sistema haría otra.
 */
export const POLITICA_IDENTIDAD = {
  /** Cuánto vale una verificación. A partir de ahí hay que revalidar (3 años). */
  validezMeses: 36,
  /** Con cuánta antelación se avisa de que toca revalidar. */
  avisoRevalidacionDias: 30,
  /** Un intento abierto sin avance durante esto se da por abandonado (libera el candado). */
  vigenciaIntentoMs: 24 * 60 * 60 * 1000,
  /** Espera mínima tras un rechazo reintentable antes de empezar otro. */
  esperaTrasRechazoMs: 5 * 60 * 1000,
  /** Rechazos reintentables en la ventana, a partir de los cuales ya no se reintenta solo: soporte. */
  maxRechazosReintentables: 3,
  ventanaRechazosMs: 7 * 24 * 60 * 60 * 1000,
} as const

// ── Máquina de estados del intento ──────────────────────────────────────────

/**
 * Orden de avance de los estados abiertos «normales». Los dos que pueden volver
 * atrás en el proceso (`reenvio_requerido`: el proveedor pidió otra captura;
 * `en_revision`: lo mira una persona) se tratan aparte.
 */
const ORDEN: Readonly<Record<string, number>> = {
  creada: 0,
  iniciada: 1,
  enviada: 2,
  en_proceso: 3,
}

export type EvaluacionTransicion =
  /** Es una transición legal: aplícala. */
  | 'aplicar'
  /** Ya estaba en ese estado: es un evento repetido, no hay nada que hacer. */
  | 'repetida'
  /** Llegó tarde (un estado anterior a uno ya alcanzado): se ignora, sin error. */
  | 'ignorar_regresion'
  /** Ilegal: otra decisión final sobre un intento ya cerrado. Se audita, no se aplica. */
  | 'prohibida'

/**
 * ¿Qué hacer cuando llega la noticia de que un intento pasó de `desde` a `hasta`?
 *
 * Las reglas, en orden:
 *  · el mismo estado → `repetida` (idempotencia);
 *  · desde un estado FINAL: un estado abierto es un evento tardío (`ignorar_regresion`);
 *    otro estado final DISTINTO es un conflicto (`prohibida`): una decisión cerrada
 *    no la cambia otra sin que alguien lo vea;
 *  · desde un estado abierto, hacia cualquier final → `aplicar` (el proveedor puede
 *    decidir sin haber avisado de los pasos intermedios);
 *  · entre abiertos «normales» solo se avanza; retroceder se ignora;
 *  · `reenvio_requerido` y `en_revision` se pueden alcanzar desde cualquier abierto, y
 *    desde ellos se vuelve a los pasos de captura o se cierra.
 */
export function evaluarTransicion(desde: string, hasta: string): EvaluacionTransicion {
  if (desde === hasta) return 'repetida'
  if (!(ESTADOS_INTENTO as readonly string[]).includes(desde)) return 'prohibida'
  if (!(ESTADOS_INTENTO as readonly string[]).includes(hasta)) return 'prohibida'

  if (esEstadoFinal(desde)) return esEstadoAbierto(hasta) ? 'ignorar_regresion' : 'prohibida'
  if (esEstadoFinal(hasta)) return 'aplicar'

  // Ambos abiertos.
  if (hasta === 'reenvio_requerido' || hasta === 'en_revision') return 'aplicar'
  if (desde === 'reenvio_requerido') return 'aplicar' // vuelve a la captura
  if (desde === 'en_revision') {
    // Una persona está mirando el caso: los pasos de captura que lleguen tarde no lo mueven.
    return 'ignorar_regresion'
  }
  return ORDEN[hasta] > ORDEN[desde] ? 'aplicar' : 'ignorar_regresion'
}

// ── Máquina de estados de la verificación global ────────────────────────────

const TRANSICIONES_VERIFICACION: Readonly<Record<EstadoVerificacion, readonly EstadoVerificacion[]>> = {
  no_verificada: ['verificada'],
  verificada: ['expirada', 'revocada', 'requiere_revalidacion'],
  expirada: ['verificada', 'revocada'],
  revocada: ['verificada'],
  requiere_revalidacion: ['verificada', 'expirada', 'revocada'],
}

export function puedeTransicionarVerificacion(desde: string, hasta: string): boolean {
  if (!(ESTADOS_VERIFICACION as readonly string[]).includes(desde)) return false
  return TRANSICIONES_VERIFICACION[desde as EstadoVerificacion].includes(hasta as EstadoVerificacion)
}

/** Por qué se pide revalidar. Va al asiento de auditoría; son códigos, no texto libre. */
export const DISPARADORES_REVALIDACION = [
  'documento_vencido',
  'cambio_de_nombre',
  'sospecha_de_fraude',
  'solicitud_de_la_persona',
  'solicitud_de_soporte',
  'politica_de_riesgo',
] as const
export type DisparadorRevalidacion = (typeof DISPARADORES_REVALIDACION)[number]

// ── Fechas: verificación y expiración ───────────────────────────────────────

/** Suma `meses` de calendario (31-ene + 1 mes = 28/29-feb, no 3-mar). */
export function sumarMeses(fecha: Date, meses: number): Date {
  const d = new Date(fecha.getTime())
  const diaOriginal = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + meses)
  const ultimoDia = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(diaOriginal, ultimoDia))
  return d
}

export function calcularExpiracion(verificadaEn: Date, politica: Pick<typeof POLITICA_IDENTIDAD, 'validezMeses'> = POLITICA_IDENTIDAD): Date {
  return sumarMeses(verificadaEn, politica.validezMeses)
}

export interface VerificacionParaEvaluar {
  estado: string
  expiraEn: Date | null
}

/**
 * El estado que VALE ahora. Una fila `verificada` cuya fecha de expiración ya
 * pasó está expirada aunque el barrido diario todavía no la haya marcado: nadie
 * puede apoyarse en una verificación vencida por un retraso del cron.
 */
export function estadoEfectivo(v: VerificacionParaEvaluar | null, ahora: Date): EstadoVerificacion {
  if (!v) return 'no_verificada'
  const estado = (ESTADOS_VERIFICACION as readonly string[]).includes(v.estado)
    ? (v.estado as EstadoVerificacion)
    : 'no_verificada'
  if ((estado === 'verificada' || estado === 'requiere_revalidacion') && v.expiraEn && v.expiraEn.getTime() <= ahora.getTime()) {
    return 'expirada'
  }
  return estado
}

export function diasParaExpirar(expiraEn: Date | null, ahora: Date): number | null {
  if (!expiraEn) return null
  return Math.ceil((expiraEn.getTime() - ahora.getTime()) / 86_400_000)
}

/** ¿Toca avisar que se acerca la revalidación? Solo si sigue verificada y falta poco. */
export function debeAvisarRevalidacion(
  v: VerificacionParaEvaluar,
  ahora: Date,
  politica: Pick<typeof POLITICA_IDENTIDAD, 'avisoRevalidacionDias'> = POLITICA_IDENTIDAD
): boolean {
  if (estadoEfectivo(v, ahora) !== 'verificada') return false
  const dias = diasParaExpirar(v.expiraEn, ahora)
  return dias !== null && dias <= politica.avisoRevalidacionDias
}

// ── Qué dijo el proveedor → qué decide MEMBEGO ──────────────────────────────

/**
 * El catálogo PROPIO de códigos de razón. Los adaptadores de cada proveedor
 * traducen lo suyo (`LOW_FACE_MATCH_SIMILARITY`, `DOCUMENT_EXPIRED`…) a estos
 * códigos; el resto del sistema no conoce al proveedor.
 *
 * `reintentable`: ¿tiene sentido volver a intentarlo tal cual (otra foto, otra
 * luz, otro documento)? `visible`: ¿se le explica el motivo a la persona? Los de
 * fraude NO: decirle qué señal saltó es enseñarle a evitarla.
 */
export const CODIGOS_RAZON = {
  DOCUMENTO_VENCIDO: {
    reintentable: true,
    visible: true,
    mensaje: 'Tu documento está vencido. Intenta de nuevo con uno vigente.',
  },
  DOCUMENTO_ILEGIBLE: {
    reintentable: true,
    visible: true,
    mensaje: 'No pudimos leer tu documento. Hazlo con buena luz, sin reflejos y con el documento completo dentro del marco.',
  },
  DOCUMENTO_NO_SOPORTADO: {
    reintentable: true,
    visible: true,
    mensaje: 'Este tipo de documento no está soportado. Usa tu cédula de identidad vigente.',
  },
  ROSTRO_NO_COINCIDE: {
    reintentable: true,
    visible: true,
    mensaje: 'La selfie no coincide con la foto del documento. Intenta de nuevo con buena luz y sin accesorios que tapen tu rostro.',
  },
  PRUEBA_DE_VIDA_FALLIDA: {
    reintentable: true,
    visible: true,
    mensaje: 'No pudimos confirmar que eres tú en este momento. Intenta de nuevo con buena luz y mirando a la cámara.',
  },
  DATOS_NO_COINCIDEN: {
    reintentable: true,
    visible: true,
    mensaje: 'Los datos del documento no coinciden con los de tu cuenta. Revisa tu nombre en el perfil e intenta de nuevo.',
  },
  SESION_EXPIRADA: {
    reintentable: true,
    visible: true,
    mensaje: 'La verificación tardó demasiado y se cerró. Puedes empezar de nuevo.',
  },
  MENOR_DE_EDAD: {
    reintentable: false,
    visible: true,
    mensaje: 'Para verificar tu identidad debes ser mayor de 18 años.',
  },
  IDENTIDAD_DUPLICADA: {
    reintentable: false,
    visible: true,
    mensaje: 'Este documento ya está asociado a otra cuenta. Contacta a soporte para que lo revisemos.',
  },
  SOSPECHA_DE_DOCUMENTO_ALTERADO: {
    reintentable: false,
    visible: false,
    mensaje: 'No pudimos verificar tu identidad. Contacta a soporte para que lo revisemos.',
  },
  SOSPECHA_DE_FRAUDE: {
    reintentable: false,
    visible: false,
    mensaje: 'No pudimos verificar tu identidad. Contacta a soporte para que lo revisemos.',
  },
  REVISION_NEGADA: {
    reintentable: false,
    visible: false,
    mensaje: 'No pudimos verificar tu identidad. Contacta a soporte para que lo revisemos.',
  },
  FLUJO_INCOMPLETO: {
    reintentable: true,
    visible: false,
    mensaje: 'No pudimos completar la verificación. Puedes intentarlo de nuevo.',
  },
  RECHAZO_GENERICO: {
    reintentable: true,
    visible: true,
    mensaje: 'No pudimos completar la verificación. Puedes intentarlo de nuevo.',
  },
} as const satisfies Record<string, { reintentable: boolean; visible: boolean; mensaje: string }>

export type CodigoRazon = keyof typeof CODIGOS_RAZON

/** Orden de gravedad al elegir el código principal cuando llegan varios: lo definitivo manda. */
const GRAVEDAD: readonly CodigoRazon[] = [
  'SOSPECHA_DE_FRAUDE',
  'SOSPECHA_DE_DOCUMENTO_ALTERADO',
  'IDENTIDAD_DUPLICADA',
  'MENOR_DE_EDAD',
  'PRUEBA_DE_VIDA_FALLIDA',
  'ROSTRO_NO_COINCIDE',
  'DATOS_NO_COINCIDEN',
  'DOCUMENTO_VENCIDO',
  'DOCUMENTO_NO_SOPORTADO',
  'DOCUMENTO_ILEGIBLE',
  'SESION_EXPIRADA',
  'REVISION_NEGADA',
  'FLUJO_INCOMPLETO',
  'RECHAZO_GENERICO',
]

export function esCodigoRazon(valor: unknown): valor is CodigoRazon {
  return typeof valor === 'string' && Object.prototype.hasOwnProperty.call(CODIGOS_RAZON, valor)
}

/**
 * El mensaje que se le muestra a la persona. Un código desconocido (un adaptador
 * que se adelantó al catálogo) cae en el genérico: NUNCA se muestra lo crudo.
 */
export function mensajeParaUsuario(codigo: string | null | undefined): string {
  return esCodigoRazon(codigo) ? CODIGOS_RAZON[codigo].mensaje : CODIGOS_RAZON.RECHAZO_GENERICO.mensaje
}

/** ¿Se explica el motivo, o se muestra solo «contacta a soporte»? */
export function motivoEsVisible(codigo: string | null | undefined): boolean {
  return esCodigoRazon(codigo) ? CODIGOS_RAZON[codigo].visible : true
}

/** Elige el código principal de una lista (el más grave) y descarta los que no están en el catálogo. */
export function codigoPrincipal(codigos: readonly string[]): CodigoRazon {
  const conocidos = codigos.filter(esCodigoRazon)
  for (const g of GRAVEDAD) if (conocidos.includes(g)) return g
  return 'RECHAZO_GENERICO'
}

/**
 * Lo que dice un proveedor, ya traducido por su adaptador a un vocabulario
 * NEUTRAL. Es la única forma en que el resto del sistema ve una decisión.
 */
export interface DecisionNeutral {
  resultado:
    | 'iniciada'
    | 'enviada'
    | 'en_proceso'
    | 'aprobada'
    | 'rechazada'
    | 'reenvio_requerido'
    | 'en_revision'
    | 'expirada'
    | 'abandonada'
    | 'cancelada'
  /** Códigos de razón ya mapeados al catálogo propio (puede venir vacío). */
  codigos?: readonly string[]
}

export interface EstadoDeIntentoResuelto {
  estado: EstadoIntento
  tipoRechazo: TipoRechazo | null
  codigoRazon: CodigoRazon | null
}

/**
 * Traduce la decisión neutral a lo que se guarda en el intento. Un rechazo es
 * DEFINITIVO si el código principal no admite reintento; si no, reintentable.
 */
export function resolverDecision(d: DecisionNeutral): EstadoDeIntentoResuelto {
  if (d.resultado === 'rechazada') {
    const codigo = codigoPrincipal(d.codigos ?? [])
    const definitivo = !CODIGOS_RAZON[codigo].reintentable
    return {
      estado: definitivo ? 'rechazada_definitiva' : 'rechazada_reintentable',
      tipoRechazo: definitivo ? 'definitivo' : 'reintentable',
      codigoRazon: codigo,
    }
  }
  if (d.resultado === 'reenvio_requerido' || d.resultado === 'en_revision') {
    return {
      estado: d.resultado,
      tipoRechazo: null,
      codigoRazon: d.codigos?.length ? codigoPrincipal(d.codigos) : null,
    }
  }
  return { estado: d.resultado, tipoRechazo: null, codigoRazon: null }
}

// ── ¿Se puede empezar otro intento? ─────────────────────────────────────────

export interface RechazoPrevio {
  resueltoAt: Date
  tipoRechazo: string | null
}

export interface ContextoNuevoIntento {
  verificacion: VerificacionParaEvaluar | null
  hayIntentoAbierto: boolean
  /** Hay un consentimiento vigente de CADA tipo necesario para capturar. */
  tieneConsentimientos: boolean
  /** Los rechazos (de cualquier fecha: la ventana se aplica aquí) del más reciente al más antiguo. */
  rechazos: readonly RechazoPrevio[]
  /** Quien lo pide es de la plantilla autorizada y quiere reabrir un caso bloqueado. */
  desbloqueoPorStaff?: boolean
}

export type EvaluacionNuevoIntento =
  | { permitido: true; esRevalidacion: boolean }
  | {
      permitido: false
      motivo:
        | 'ya_verificada'
        | 'intento_abierto'
        | 'falta_consentimiento'
        | 'espera'
        | 'bloqueada_por_rechazo_definitivo'
        | 'demasiados_rechazos'
      /** Solo con `espera`: cuándo puede volver a intentarlo. */
      esperarHasta?: Date
    }

/**
 * La regla única de «¿esta persona puede empezar una verificación ahora?».
 * Va en el núcleo porque la decisión es lo que hay que probar, y porque la
 * pantalla y el servidor tienen que coincidir en el porqué.
 *
 * El orden importa: lo que no se arregla esperando (verificada, bloqueo) va
 * antes que lo que sí (espera).
 */
export function evaluarNuevoIntento(
  ctx: ContextoNuevoIntento,
  ahora: Date,
  politica: typeof POLITICA_IDENTIDAD = POLITICA_IDENTIDAD
): EvaluacionNuevoIntento {
  const efectivo = estadoEfectivo(ctx.verificacion, ahora)
  // «Cuenta previamente verificada»: no se vuelve a verificar mientras valga.
  if (efectivo === 'verificada') return { permitido: false, motivo: 'ya_verificada' }

  if (ctx.hayIntentoAbierto) return { permitido: false, motivo: 'intento_abierto' }
  if (!ctx.tieneConsentimientos) return { permitido: false, motivo: 'falta_consentimiento' }

  if (!ctx.desbloqueoPorStaff) {
    const ultimo = ctx.rechazos[0]
    if (ultimo?.tipoRechazo === 'definitivo') {
      return { permitido: false, motivo: 'bloqueada_por_rechazo_definitivo' }
    }
    const desde = ahora.getTime() - politica.ventanaRechazosMs
    const recientes = ctx.rechazos.filter(
      (r) => r.tipoRechazo === 'reintentable' && r.resueltoAt.getTime() >= desde
    )
    if (recientes.length >= politica.maxRechazosReintentables) {
      return { permitido: false, motivo: 'demasiados_rechazos' }
    }
    if (ultimo?.tipoRechazo === 'reintentable') {
      const hasta = new Date(ultimo.resueltoAt.getTime() + politica.esperaTrasRechazoMs)
      if (hasta.getTime() > ahora.getTime()) return { permitido: false, motivo: 'espera', esperarHasta: hasta }
    }
  }

  return { permitido: true, esRevalidacion: efectivo === 'expirada' || efectivo === 'requiere_revalidacion' || efectivo === 'revocada' }
}

// ── Dedupe por documento (sin guardar el número) ────────────────────────────

/**
 * HMAC-SHA256(pepper, «tipo|número|país») en hexadecimal. Sirve SOLO para
 * detectar que dos cuentas presentan el mismo documento; el número se normaliza
 * (mayúsculas, solo letras y dígitos) y se DESCARTA tras hashear. Con un pepper
 * secreto (variable de entorno, fuera de la base) un volcado de la tabla no
 * permite probar números de cédula contra los hashes.
 */
export function calcularHashDedupe(
  pepper: string,
  doc: { tipoDocumento: string; numeroDocumento: string; pais: string }
): string {
  if (typeof pepper !== 'string' || pepper.length < 32) {
    throw new Error('calcularHashDedupe: el pepper debe tener al menos 32 caracteres.')
  }
  const numero = doc.numeroDocumento.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!numero) throw new Error('calcularHashDedupe: el número de documento está vacío.')
  const tipo = doc.tipoDocumento.trim().toUpperCase()
  const pais = doc.pais.trim().toUpperCase()
  return createHmac('sha256', pepper).update(`${tipo}|${numero}|${pais}`).digest('hex')
}

// ── Lo que se le enseña a la persona ────────────────────────────────────────

/**
 * El estado de identidad que VE una persona (o la pantalla en su nombre). Solo
 * lo comunicable: nunca la referencia del proveedor, ni el hash, ni los
 * códigos internos de un rechazo definitivo con motivo no visible.
 */
export interface EstadoIdentidadPublico {
  estado: EstadoVerificacion
  nivel: NivelIdentidad | null
  verificadaEn: Date | null
  expiraEn: Date | null
  /** Días hasta expirar (solo si está verificada). */
  diasParaExpirar: number | null
  /** ¿Se acerca la fecha en que hay que revalidar? */
  revalidacionProxima: boolean
  intentoAbierto: { id: string; estado: EstadoIntento } | null
  ultimoRechazo: {
    reintentable: boolean
    /** Null si el motivo no se explica (fraude): la pantalla dice «contacta a soporte». */
    codigo: CodigoRazon | null
    mensaje: string
  } | null
  /** Resultado de `evaluarNuevoIntento`, para que la pantalla ofrezca o no el botón. */
  puedeIniciar: boolean
  motivoNoPuedeIniciar: string | null
  esperarHasta: Date | null
}
