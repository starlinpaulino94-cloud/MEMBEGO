import {
  POLITICA_IDENTIDAD,
  type EstadoIdentidadPublico,
  type EstadoIntento,
  type EstadoVerificacion,
} from '@/modules/identidad/identidadCore'
import {
  RUTA_POLITICA_IDENTIDAD,
  TIPOS_CONSENTIMIENTO_IDENTIDAD,
  TIPOS_REQUERIDOS_PARA_CAPTURAR,
  VERSION_VIGENTE,
  partirTextoIdentidad,
  renderizarTextoIdentidad,
  type TipoConsentimientoIdentidad,
} from '@/modules/identidad/identidadConsentimientosCore'

/**
 * LO QUE LA PERSONA VE DE SU VERIFICACIÓN DE IDENTIDAD (Fase 3), decidido en el
 * SERVIDOR y en un solo sitio.
 *
 * La web y la app móvil NO deciden nada: reciben esta vista ya armada (el estado,
 * qué botón ofrecer, qué decir, con qué tono) y la pintan. Así los textos no se
 * pueden contradecir entre superficies, el estado es «server-authoritative» como
 * manda el contrato de la app, y todo se prueba aquí con valores, sin pantallas.
 *
 * REGLAS DE REDACCIÓN
 *  · Nunca se promete lo que el sistema no hace. Los plazos salen de
 *    `POLITICA_IDENTIDAD` y una prueba los cruza con la política pública.
 *  · El motivo de un rechazo por fraude NO se dice (`ultimoRechazo.codigo === null`):
 *    «contacta a soporte» y nada más. Nunca se muestra texto del proveedor.
 *  · Verificar es OPCIONAL y se dice: no condiciona comprar ni usar las membresías.
 *  · Un estado se dice con texto, no solo con color (principio P3 del sistema de diseño).
 */

/** El nombre con el que se le presenta el proveedor a la persona. */
export const PROVEEDOR_VISIBLE = 'Didit'

export type TonoDeVista = 'exito' | 'aviso' | 'info' | 'neutro' | 'peligro'

/** Qué botón principal se ofrece. `esperar` y `ninguna` no llevan botón. */
export type AccionDeVista = 'verificar' | 'continuar' | 'reintentar' | 'esperar' | 'contactar' | 'ninguna'

export interface VistaDeIdentidad {
  /** El estado de la verificación global (para los lectores de pantalla y las pruebas). */
  estado: EstadoVerificacion
  /** El estado del intento abierto, si lo hay. */
  intento: EstadoIntento | null
  tono: TonoDeVista
  /** La etiqueta corta del estado («Verificada», «En revisión»…). */
  etiqueta: string
  titulo: string
  descripcion: string
  accion: AccionDeVista
  /** El texto del botón principal; `null` si no hay. */
  textoAccion: string | null
  /** Antes de empezar hay que ver y aceptar los consentimientos obligatorios. */
  requiereConsentimientos: boolean
  /** La pantalla debe volver a preguntar el estado cada pocos segundos (hay algo por resolverse). */
  sondear: boolean
  /** Un aviso aparte (revalidación cercana, espera, límite de intentos). */
  aviso: { tono: TonoDeVista; texto: string } | null
  /** Se puede reportar un problema. */
  puedeReportar: boolean
  /** Hay resultado o intentos que borrar. */
  puedeBorrar: boolean
  /** Se muestra el interruptor «que los negocios vean que estoy verificado». */
  mostrarDivulgacion: boolean
}

// ── Formato ─────────────────────────────────────────────────────────────────

const ZONA = 'America/Santo_Domingo'

/** «22 de octubre de 2026», en la hora de Santo Domingo. */
export function fechaLarga(d: Date): string {
  return new Intl.DateTimeFormat('es-DO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: ZONA }).format(d)
}

/** «3:45 p. m.», en la hora de Santo Domingo. */
export function horaCorta(d: Date): string {
  return new Intl.DateTimeFormat('es-DO', { hour: 'numeric', minute: '2-digit', timeZone: ZONA }).format(d)
}

// ── Explicación, privacidad, incidencias ────────────────────────────────────

export const PASOS_DE_VERIFICACION: readonly string[] = [
  'Fotografías tu cédula con la cámara del teléfono.',
  'Te tomas una selfie y sigues una pequeña prueba de vida (por ejemplo, mover la cabeza).',
  'Comparamos tu rostro con el de la cédula y te avisamos del resultado, normalmente en unos minutos.',
]

/**
 * La información de privacidad que se muestra junto al botón. Cada cifra sale de
 * la política (`POLITICA_IDENTIDAD`) y `tests/politicas-identidad.test.ts` la cruza
 * con lo que dice `/privacy#verificacion-identidad`: lo que se le dice a la persona
 * aquí y lo que se publica tienen que coincidir.
 */
export function puntosDePrivacidad(politica: { validezMeses: number } = POLITICA_IDENTIDAD): string[] {
  const años = politica.validezMeses / 12
  return [
    'Usamos la foto de tu cédula y una selfie solo para comprobar que eres el titular del documento y prevenir fraude y robo de identidad.',
    `${PROVEEDOR_VISIBLE} procesa tus datos en la Unión Europea, por cuenta de Membego y bajo contrato.`,
    `${PROVEEDOR_VISIBLE} elimina las imágenes y los datos biométricos al concluir. Membego conserva solo el resultado (si estás verificado, el nivel y la fecha) durante ${años} años.`,
    'Los negocios donde eres cliente solo ven si estás verificado y desde cuándo, y solo si tú lo permites. Nunca ven tu cédula ni tu selfie.',
    'Puedes retirar tu permiso y pedir que borremos tus datos de verificación cuando quieras.',
  ]
}

export const TIPOS_DE_INCIDENCIA = [
  { valor: 'no_puedo_completar', etiqueta: 'No puedo completar la verificación' },
  { valor: 'rechazo_incorrecto', etiqueta: 'Creo que el resultado es incorrecto' },
  { valor: 'datos_incorrectos', etiqueta: 'Mis datos salen mal' },
  { valor: 'otro', etiqueta: 'Otro problema' },
] as const
export type TipoDeIncidencia = (typeof TIPOS_DE_INCIDENCIA)[number]['valor']

export function esTipoDeIncidencia(valor: unknown): valor is TipoDeIncidencia {
  return TIPOS_DE_INCIDENCIA.some((t) => t.valor === valor)
}

export const MAX_MENSAJE_INCIDENCIA = 600
/** Incidencias abiertas a la vez por persona: una cola que nadie puede inundar. */
export const MAX_INCIDENCIAS_ABIERTAS = 3

/** Lo que se le pide a la persona al contar su problema. */
export const AVISO_DE_INCIDENCIA = 'No escribas tu número de cédula ni tus contraseñas: no hace falta para ayudarte.'

// ── Consentimientos para la pantalla ────────────────────────────────────────

export interface ConsentimientoDePanel {
  tipo: TipoConsentimientoIdentidad
  /** Sin este no se captura nada. La divulgación a negocios no es obligatoria. */
  obligatorio: boolean
  /** La versión del texto que se muestra: es la que se registra al aceptar. */
  textoVersion: string
  titulo: string
  detalle: string
  /** La persona ya aceptó ESTA versión del texto. */
  vigente: boolean
}

/** Los tres consentimientos, con su texto vigente, y cuáles tiene ya aceptados la persona (tipo → versión). */
export function consentimientosParaPantalla(aceptados: ReadonlyMap<TipoConsentimientoIdentidad, string>): ConsentimientoDePanel[] {
  return TIPOS_CONSENTIMIENTO_IDENTIDAD.map((tipo) => {
    const textoVersion = VERSION_VIGENTE[tipo]
    const { titulo, detalle } = partirTextoIdentidad(renderizarTextoIdentidad(textoVersion, { proveedor: PROVEEDOR_VISIBLE }))
    return {
      tipo,
      obligatorio: TIPOS_REQUERIDOS_PARA_CAPTURAR.includes(tipo),
      textoVersion,
      titulo,
      detalle,
      vigente: aceptados.get(tipo) === textoVersion,
    }
  })
}

export const URL_CONDICIONES_IDENTIDAD = RUTA_POLITICA_IDENTIDAD

// ── Errores al empezar ──────────────────────────────────────────────────────

/** Lo que se le dice a la persona cuando no se pudo empezar, por motivo. Nunca un código técnico. */
export function mensajeDeNoPudoEmpezar(motivo: string, esperarHasta?: Date | null): string {
  switch (motivo) {
    case 'falta_consentimiento':
      return 'Para empezar necesitamos tu permiso: marca las casillas obligatorias.'
    case 'espera':
      return esperarHasta
        ? `Podrás intentarlo de nuevo a las ${horaCorta(esperarHasta)}.`
        : 'Espera unos minutos antes de intentarlo de nuevo.'
    case 'demasiados_rechazos':
      return 'Llegaste al límite de intentos de esta semana. Cuéntanos qué pasa y te ayudamos.'
    case 'bloqueada_por_rechazo_definitivo':
      return 'No podemos repetir esta verificación desde la aplicación. Contacta a soporte.'
    case 'ya_verificada':
      return 'Tu identidad ya está verificada.'
    case 'en_revision':
      return 'Tu verificación está en revisión: no hace falta repetirla.'
    case 'no_habilitada':
      return 'La verificación de identidad no está disponible por ahora.'
    case 'proveedor_no_disponible':
      return 'El servicio de verificación no responde en este momento. Inténtalo en un minuto.'
    case 'persona_no_encontrada':
      return 'No pudimos encontrar tu cuenta.'
    case 'texto_cambio':
      return 'El texto de los permisos cambió. Léelo de nuevo y acéptalo para continuar.'
    case 'demasiadas_solicitudes':
      return 'Demasiados intentos seguidos. Espera un momento.'
    default:
      return 'No pudimos iniciar la verificación. Inténtalo más tarde.'
  }
}

// ── La vista ────────────────────────────────────────────────────────────────

export interface ContextoDeVista {
  /** La persona tiene aceptados los consentimientos obligatorios en su versión vigente. */
  consentimientosObligatoriosVigentes: boolean
  /** Hay resultado o intentos que borrar. */
  tieneDatos: boolean
  ahora: Date
}

const ESTADOS_QUE_ESPERAN: readonly EstadoIntento[] = ['enviada', 'en_proceso']
const ESTADOS_A_MEDIAS: readonly EstadoIntento[] = ['creada', 'iniciada', 'reenvio_requerido']

/**
 * La vista de la persona a partir de su estado. Las ramas van por prioridad:
 * verificada → un intento abierto → el último rechazo → vencida/revocada → sin verificar.
 */
export function construirVista(estado: EstadoIdentidadPublico, ctx: ContextoDeVista): VistaDeIdentidad {
  const base = {
    estado: estado.estado,
    intento: estado.intentoAbierto?.estado ?? null,
    aviso: null as VistaDeIdentidad['aviso'],
    puedeBorrar: ctx.tieneDatos,
    mostrarDivulgacion: false,
    puedeReportar: false,
    sondear: false,
    requiereConsentimientos: false,
  }
  // Pide los consentimientos solo si de verdad se va a empezar algo y faltan.
  const pideConsentimientos = !ctx.consentimientosObligatoriosVigentes

  if (estado.estado === 'verificada') {
    const dias = estado.diasParaExpirar
    return {
      ...base,
      tono: 'exito',
      etiqueta: 'Verificada',
      titulo: 'Tu identidad está verificada',
      descripcion: [
        estado.verificadaEn ? `La verificaste el ${fechaLarga(estado.verificadaEn)}.` : null,
        estado.expiraEn ? `Vale hasta el ${fechaLarga(estado.expiraEn)}.` : null,
      ]
        .filter(Boolean)
        .join(' '),
      accion: 'ninguna',
      textoAccion: null,
      mostrarDivulgacion: true,
      puedeReportar: true,
      aviso:
        estado.revalidacionProxima && dias !== null
          ? {
              tono: 'aviso',
              texto:
                dias <= 0
                  ? 'Tu verificación vence hoy. Cuando venza, podrás verificarte de nuevo desde aquí.'
                  : `Tu verificación vence en ${dias} ${dias === 1 ? 'día' : 'días'}. Cuando venza, podrás verificarte de nuevo desde aquí.`,
            }
          : null,
    }
  }

  const intento = estado.intentoAbierto?.estado ?? null
  if (intento === 'en_revision') {
    return {
      ...base,
      tono: 'info',
      etiqueta: 'En revisión',
      titulo: 'Estamos revisando tu verificación',
      descripcion: 'Una persona del equipo de Membego la está revisando. Te avisaremos cuando haya un resultado; no tienes que hacer nada.',
      accion: 'esperar',
      textoAccion: null,
      sondear: true,
      puedeReportar: true,
    }
  }
  if (intento && ESTADOS_QUE_ESPERAN.includes(intento)) {
    return {
      ...base,
      tono: 'info',
      etiqueta: 'En proceso',
      titulo: 'Estamos procesando tu verificación',
      descripcion: 'Ya recibimos tus datos y los estamos comprobando. Suele tardar unos minutos; puedes cerrar esta pantalla, te avisaremos.',
      accion: 'esperar',
      textoAccion: null,
      sondear: true,
      puedeReportar: true,
    }
  }
  if (intento && ESTADOS_A_MEDIAS.includes(intento)) {
    const repetir = intento === 'reenvio_requerido'
    return {
      ...base,
      tono: 'aviso',
      etiqueta: 'Pendiente',
      titulo: repetir ? 'Necesitamos que repitas un paso' : 'Tu verificación está a medias',
      descripcion: repetir
        ? 'No pudimos leer bien lo que enviaste. Continúa y repite el paso que te pidan.'
        : 'Empezaste pero no terminaste. Puedes continuar donde la dejaste.',
      accion: 'continuar',
      textoAccion: 'Continuar verificación',
      requiereConsentimientos: pideConsentimientos,
      // Al volver del proveedor el aviso puede estar en camino: se pregunta de vez en cuando.
      sondear: true,
      puedeReportar: true,
    }
  }

  // Sin intento abierto: el último rechazo manda sobre el estado «sin verificar».
  if (estado.ultimoRechazo) {
    const r = estado.ultimoRechazo
    if (!r.reintentable) {
      return {
        ...base,
        tono: 'peligro',
        etiqueta: 'No verificada',
        titulo: 'No pudimos verificar tu identidad',
        descripcion: r.mensaje,
        accion: 'contactar',
        textoAccion: 'Contar mi problema',
        puedeReportar: true,
      }
    }
    if (estado.motivoNoPuedeIniciar === 'demasiados_rechazos') {
      return {
        ...base,
        tono: 'aviso',
        etiqueta: 'No verificada',
        titulo: 'La verificación no se completó',
        descripcion: r.mensaje,
        accion: 'contactar',
        textoAccion: 'Contar mi problema',
        aviso: { tono: 'aviso', texto: mensajeDeNoPudoEmpezar('demasiados_rechazos') },
        puedeReportar: true,
      }
    }
    const enEspera = estado.motivoNoPuedeIniciar === 'espera'
    return {
      ...base,
      tono: 'aviso',
      etiqueta: 'No verificada',
      titulo: 'La verificación no se completó',
      descripcion: r.mensaje,
      accion: enEspera ? 'esperar' : 'reintentar',
      textoAccion: enEspera ? null : 'Intentar de nuevo',
      requiereConsentimientos: !enEspera && pideConsentimientos,
      aviso: enEspera ? { tono: 'info', texto: mensajeDeNoPudoEmpezar('espera', estado.esperarHasta) } : null,
      puedeReportar: true,
    }
  }

  if (estado.estado === 'expirada' || estado.estado === 'requiere_revalidacion') {
    const caducada = estado.estado === 'expirada'
    return {
      ...base,
      tono: 'aviso',
      etiqueta: caducada ? 'Vencida' : 'Revalidación necesaria',
      titulo: caducada ? 'Tu verificación venció' : 'Necesitamos que vuelvas a verificarte',
      descripcion: caducada
        ? 'Una verificación vale ' + POLITICA_IDENTIDAD.validezMeses / 12 + ' años. Puedes verificarte de nuevo cuando quieras.'
        : 'Algo cambió y tenemos que comprobar tu identidad otra vez. Puedes hacerlo ahora.',
      accion: 'verificar',
      textoAccion: 'Verificar de nuevo',
      requiereConsentimientos: pideConsentimientos,
      puedeReportar: true,
    }
  }
  if (estado.estado === 'revocada') {
    return {
      ...base,
      tono: 'peligro',
      etiqueta: 'Retirada',
      titulo: 'Retiramos tu verificación',
      descripcion: 'Si crees que fue un error, cuéntanoslo y lo revisamos. También puedes verificarte de nuevo.',
      accion: estado.puedeIniciar ? 'verificar' : 'contactar',
      textoAccion: estado.puedeIniciar ? 'Verificar de nuevo' : 'Contar mi problema',
      requiereConsentimientos: estado.puedeIniciar && pideConsentimientos,
      puedeReportar: true,
    }
  }

  // Nunca ha verificado (o lo borró).
  return {
    ...base,
    tono: 'neutro',
    etiqueta: 'Sin verificar',
    titulo: 'Verifica tu identidad',
    descripcion: 'Es opcional: no hace falta para comprar ni para usar tus membresías. Tarda unos minutos y solo necesitas tu cédula.',
    accion: 'verificar',
    textoAccion: 'Verificar mi identidad',
    requiereConsentimientos: pideConsentimientos,
  }
}
