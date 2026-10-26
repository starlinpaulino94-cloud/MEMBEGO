/**
 * POLÍTICA DE LA RENOVACIÓN AUTOMÁTICA CON TARJETA GUARDADA — núcleo puro.
 *
 * Sin Prisma ni Next: las decisiones que no necesitan la base viven aquí y se
 * prueban con valores (`tests/renovacion-politica.test.ts`). Lo que escribe en la
 * base está en `cardnetTokenGuardado.ts`.
 *
 * QUÉ RESUELVE
 *
 *  1. QUÉ FUE un cobro que no se aprobó. «Rechazado» es una frase con
 *     consecuencias —se le dice al cliente que NO se le cobró, se cuenta como uno
 *     de sus intentos, puede apagarle la renovación—, así que solo se usa cuando
 *     el banco o la pasarela DIJERON que no. Un cobro que se cayó sin respuesta
 *     no es un rechazo: es un cobro de resultado desconocido, y repetirlo al día
 *     siguiente es la receta del doble cargo (`clasificarCobro`).
 *  2. CUÁNTAS VECES se insiste y con qué separación (`evaluarCiclo`).
 *  3. QUÉ PASA tras un rechazo: reintentar o rendirse (`decidirTrasRechazo`).
 *
 * El VENCIMIENTO de la tarjeta no se decide aquí: lo decide
 * `cardnet-expiracion.ts` (`tarjetaCardnetVencida`), que ya existía.
 *
 * LAS CIFRAS (3 intentos, el primero 3 días antes del vencimiento) las confirmó
 * el dueño del negocio el 21-10-2026. Están todas aquí, en un solo objeto, para
 * que cambiarlas sea una línea. Pero NO se cambian a ciegas: el texto de
 * consentimiento `renovacion-v2` le dice al cliente cuántos intentos son, y una
 * prueba obliga a que coincidan.
 */

const HORA = 60 * 60 * 1000
const DIA = 24 * HORA

export const POLITICA_RENOVACION = {
  /**
   * Cuántos rechazos reales aguanta un ciclo antes de apagar la renovación
   * automática. Es un TOPE, no una promesa: el tiempo disponible puede acortarlo
   * (ver `decidirTrasRechazo`).
   */
  maxRechazosPorCiclo: 3,

  /**
   * Cuántos días ANTES del vencimiento se hace el primer intento.
   *
   * Con la separación de un cron diario, esto es lo que decide cuántos intentos
   * caben. Con 1 día (lo que había) caben uno o dos antes de que el job de
   * vencimientos pase la membresía a VENCIDA, y entonces «3 intentos» era
   * imposible. La renovación extiende DESDE el vencimiento actual mientras sea
   * futuro, así que cobrar antes no le quita ni un día al cliente.
   */
  diasAntesDelPrimerIntento: 3,

  /**
   * Separación mínima entre dos intentos de la misma membresía. Por debajo del
   * período del cron (24 h) a propósito: deja pasar el siguiente día aunque el
   * cron se atrase o se adelante unos minutos, y frena el segundo disparo del
   * mismo día (un reintento de la plataforma, un disparo manual).
   */
  espaciadoMinimoMs: 20 * HORA,

  /**
   * Hasta dónde mirar para saber si habrá OTRO intento: el siguiente corre en
   * ~24 h, y se deja una hora de holgura por el retraso del cron. Si ese
   * momento cae después del vencimiento, no hay siguiente intento y decir «lo
   * volveremos a intentar» sería prometer algo que no va a pasar.
   */
  horizonteDeReintentoMs: 25 * HORA,

  /**
   * Cuántos días antes del vencimiento se avisa de que se renovará sola. Es
   * mayor que `diasAntesDelPrimerIntento` a propósito: el aviso tiene que llegar
   * ANTES del primer cobro, con margen para que el cliente reaccione.
   */
  avisoPrevioDias: 7,

  /** Un intento sin resultado más viejo que esto se da por perdido, no por «en curso». */
  intentoEnCursoMs: 15 * 60 * 1000,
} as const

/** Margen de selección del cron: «faltan ≤ N días para vencer». */
export const MARGEN_PRIMER_INTENTO_MS = POLITICA_RENOVACION.diasAntesDelPrimerIntento * DIA

// ── 1 · Qué fue el cobro ────────────────────────────────────────────────────

/**
 * - `aprobada`: el cobro se hizo.
 * - `rechazo`: el banco o la pasarela dijeron que no, y otro intento puede salir
 *   distinto (fondos, límite, el banco caído un rato).
 * - `rechazo_definitivo`: dijeron que no y reintentar no lo arregla (tarjeta
 *   vencida, reportada, número inválido, perfil sin habilitar).
 * - `incierto`: NO se sabe si se cobró. Sin respuesta, error del servidor, o un
 *   código que dice «este pago ya se procesó». No se avisa al cliente de nada
 *   que no se sepa, y no se vuelve a cobrar hasta que alguien lo concilie.
 * - `tecnico`: la pasarela ni siquiera procesó la petición (llave inválida, ruta
 *   que no existe). Seguro que NO se cobró, y no es culpa del cliente: no cuenta
 *   como rechazo ni se le avisa.
 */
export type ClaseCobro = 'aprobada' | 'rechazo' | 'rechazo_definitivo' | 'incierto' | 'tecnico'

/**
 * Códigos de respuesta (manual §9.2) con los que reintentar es inútil:
 * 14 número inválido · 41 y 43 tarjeta reportada · 54 vencida.
 *
 * Una lista corta a propósito. Apagar la renovación de alguien por un código mal
 * clasificado es peor que gastar un intento de más: ante la duda, `rechazo`.
 */
const CODIGOS_DEFINITIVOS: ReadonlySet<string> = new Set(['14', '41', '43', '54'])

/**
 * Códigos que NO dicen «no se cobró»: el 94 es «este pago ya se procesó». Tratarlo
 * como un rechazo le diría al cliente que no se le cobró cuando sí.
 */
const CODIGOS_DE_RESULTADO_INCIERTO: ReadonlySet<string> = new Set(['94'])

/** Estados HTTP con los que la pasarela rechazó la petición sin procesarla. */
const HTTP_SIN_PROCESAR: ReadonlySet<number> = new Set([401, 403, 404])

export interface CobroParaClasificar {
  aprobada: boolean
  /** Código crudo del emisor o la plataforma; vacío si no hubo. */
  codigo: string
  /** La pasarela dijo que el perfil aún no está activado (CS012 / PR001). */
  requiereActivacion: boolean
  /** Estado HTTP de la llamada (`crudo._http`). 0 = sin respuesta. */
  httpStatus: number | null | undefined
}

/**
 * Clasifica el resultado de UN cobro. Ver `ClaseCobro`.
 *
 * El orden importa y es de más a menos peligroso: primero se descarta que el
 * cobro esté en el aire (sin respuesta o error del servidor), porque ahí ningún
 * código del cuerpo es de fiar; después, lo que el banco dijo.
 */
export function clasificarCobro(c: CobroParaClasificar): ClaseCobro {
  if (c.aprobada) return 'aprobada'
  const status = typeof c.httpStatus === 'number' ? c.httpStatus : 0
  if (status === 0 || status >= 500) return 'incierto'
  const codigo = c.codigo.trim()
  if (CODIGOS_DE_RESULTADO_INCIERTO.has(codigo)) return 'incierto'
  if (c.requiereActivacion) return 'rechazo_definitivo'
  if (codigo) return CODIGOS_DEFINITIVOS.has(codigo) ? 'rechazo_definitivo' : 'rechazo'
  if (HTTP_SIN_PROCESAR.has(status)) return 'tecnico'
  // Sin código y sin una razón clara de que no se procesó: no se sabe. Es el
  // caso que más importa que NO se trate como rechazo.
  return 'incierto'
}

// ── 2 · El ciclo de una renovación ──────────────────────────────────────────

/**
 * Lo que `evaluarCiclo` necesita saber de un intento anterior. Es una vista
 * mínima de `PagoIntento` para poder probar la regla sin base de datos.
 */
export interface IntentoDelCiclo {
  estado: string
  createdAt: Date
  activadoAt: Date | null
  fulfillmentEstado: string
  /** `respuesta._clasificacion` del intento, si la guardó el cobro. */
  clasificacion: string | null
  /**
   * `true` si lo creó el cron de renovación. Los intentos del cliente (un pago
   * manual con otra tarjeta, por ejemplo) también cuentan para NO cobrar encima
   * de ellos, pero no gastan los rechazos que tiene el cron.
   */
  delCron: boolean
}

export type MotivoDeBloqueo =
  /** Hubo un intento hace menos de `espaciadoMinimoMs`, o uno sigue en curso. */
  | 'reciente'
  /** Ya se usaron los rechazos que permite el ciclo. */
  | 'agotado'
  /** Un intento anterior quedó con resultado desconocido: no se vuelve a cobrar. */
  | 'incierto'
  /** Un intento anterior COBRÓ pero la membresía no se extendió: ya se cobró. */
  | 'cobrado'

export type EvaluacionCiclo = { permitido: true } | { permitido: false; motivo: MotivoDeBloqueo }

/**
 * ¿Se puede intentar cobrar ahora esta renovación? Mira SOLO los intentos del
 * ciclo (ver `inicioDelCiclo`).
 *
 * El orden es de más grave a menos, y es el que evita el doble cargo:
 *
 *  1. Un intento que COBRÓ y no extendió la membresía (`activadoAt` sin entrega
 *     completada). La membresía sigue pareciendo por vencer, así que el cron la
 *     elegiría otra vez y le cobraría de nuevo. Es un caso para una persona.
 *  2. Un intento de resultado desconocido (un cobro sin respuesta, o uno que
 *     quedó `CREADO` sin cerrar y ya no puede estar en curso). Puede haber
 *     cobrado: tampoco se repite solo.
 *  3. Uno en curso o demasiado reciente.
 *  4. Los rechazos reales ya llegaron al tope.
 */
export function evaluarCiclo(
  intentos: readonly IntentoDelCiclo[],
  ahora: Date,
  politica: Pick<
    typeof POLITICA_RENOVACION,
    'maxRechazosPorCiclo' | 'espaciadoMinimoMs' | 'intentoEnCursoMs'
  > = POLITICA_RENOVACION
): EvaluacionCiclo {
  const t = ahora.getTime()

  // `DESCARTADA` (cerrado sin entregar desde la conciliación) también bloquea, a propósito: el cobro SALIÓ en este ciclo, y
  // volver a cobrar solo porque alguien anotó «se reembolsó» es un doble cargo si el reembolso no llegó a hacerse.
  if (intentos.some((i) => i.activadoAt !== null && i.fulfillmentEstado !== 'COMPLETADA')) {
    return { permitido: false, motivo: 'cobrado' }
  }

  const perdido = (i: IntentoDelCiclo) =>
    i.estado === 'CREADO' && t - i.createdAt.getTime() > politica.intentoEnCursoMs
  if (intentos.some((i) => (i.estado === 'ERROR' && i.clasificacion === 'incierto') || perdido(i))) {
    return { permitido: false, motivo: 'incierto' }
  }

  const enCurso = (i: IntentoDelCiclo) =>
    i.estado === 'CREADO' && t - i.createdAt.getTime() <= politica.intentoEnCursoMs
  if (
    intentos.some(
      (i) => enCurso(i) || t - i.createdAt.getTime() < politica.espaciadoMinimoMs
    )
  ) {
    return { permitido: false, motivo: 'reciente' }
  }

  if (rechazosDelCron(intentos) >= politica.maxRechazosPorCiclo) {
    return { permitido: false, motivo: 'agotado' }
  }

  return { permitido: true }
}

/** Cuántos rechazos reales lleva el cron en este ciclo. Los del cliente no cuentan. */
export function rechazosDelCron(intentos: readonly IntentoDelCiclo[]): number {
  return intentos.filter((i) => i.delCron && i.estado === 'RECHAZADO').length
}

export type VeredictoDeVentana =
  | { toca: true }
  | {
      toca: false
      razon:
        /** Sin vencimiento no hay nada que renovar. */
        | 'sin_fecha'
        /** Falta más que el margen del primer intento. */
        | 'todavia_no'
        /** Venció hace más de la gracia: ya no se resucita cobrando. */
        | 'ya_vencio'
        /** Se pagó hace menos de la separación mínima. */
        | 'pagada_hace_poco'
    }

/**
 * ¿TOCA renovar esta membresía AHORA? La misma ventana con la que el cron la
 * elige, comprobada otra vez por quien va a cobrar.
 *
 * Hace falta porque entre elegir y cobrar pasa tiempo, y a veces otra ejecución:
 * dos crons que listan la misma membresía, el segundo llega cuando el primero ya
 * la renovó. Sin esta comprobación, el segundo lee el estado NUEVO —vencimiento
 * un período adelante— y cobra otra vez, porque el ciclo también se movió y ya
 * no ve el intento del primero. Aquí se detiene por la ventana; y si el plan es
 * tan corto que el vencimiento nuevo vuelve a caer dentro del margen, por
 * «pagada hace poco».
 *
 * `graciaMs` es cuánto atrás se acepta un vencimiento (ver `GRACIA_VENCIDA_MS`).
 */
export function tocaRenovar(input: {
  vencimiento: Date | null | undefined
  fechaPago: Date | null | undefined
  ahora: Date
  graciaMs: number
  politica?: Pick<typeof POLITICA_RENOVACION, 'espaciadoMinimoMs'>
}): VeredictoDeVentana {
  const politica = input.politica ?? POLITICA_RENOVACION
  if (!input.vencimiento) return { toca: false, razon: 'sin_fecha' }
  const v = input.vencimiento.getTime()
  const t = input.ahora.getTime()
  if (v > t + MARGEN_PRIMER_INTENTO_MS) return { toca: false, razon: 'todavia_no' }
  if (v < t - input.graciaMs) return { toca: false, razon: 'ya_vencio' }
  if (input.fechaPago && t - input.fechaPago.getTime() < politica.espaciadoMinimoMs) {
    return { toca: false, razon: 'pagada_hace_poco' }
  }
  return { toca: true }
}

/**
 * DESDE CUÁNDO cuentan los intentos de una renovación.
 *
 * El ciclo no se guarda: se deduce del vencimiento. Empieza un poco antes de que
 * el cron pueda elegir la membresía y nunca antes del último pago (`fechaPago`).
 * Lo segundo importa en los planes cortos: con un plan de 2 días, el cobro de la
 * renovación anterior cae DENTRO de la ventana del ciclo siguiente, y sin este
 * suelo contaría como un intento de éste.
 *
 * Una renovación aprobada mueve el vencimiento un período adelante, así que el
 * ciclo siguiente empieza de cero sin que nadie tenga que reiniciar nada.
 */
export function inicioDelCiclo(vencimiento: Date, fechaPago: Date | null | undefined): Date {
  const abre = vencimiento.getTime() - MARGEN_PRIMER_INTENTO_MS - 12 * HORA
  return new Date(Math.max(abre, fechaPago?.getTime() ?? 0))
}

/** Identifica el ciclo para deduplicar avisos: la fecha de vencimiento, «2026-10-24». */
export function claveDeCiclo(vencimiento: Date): string {
  return vencimiento.toISOString().slice(0, 10)
}

// ── 3 · Qué pasa tras un rechazo ────────────────────────────────────────────

export type CausaDeCierre =
  /** El rechazo no se arregla reintentando (tarjeta vencida, reportada…). */
  | 'definitivo'
  /** Se usaron todos los intentos del ciclo. */
  | 'agotado'
  /** Quedan intentos, pero el siguiente caería después del vencimiento. */
  | 'sin_tiempo'

export type DecisionTrasRechazo = { accion: 'reintentar' } | { accion: 'desactivar'; causa: CausaDeCierre }

/**
 * Reintentar o apagar la renovación automática, tras un rechazo REAL.
 *
 * `rechazosEnCiclo` incluye el que acaba de ocurrir.
 *
 * «Sin tiempo» es la regla que mantiene honestos los avisos: el cliente recibe
 * «lo volveremos a intentar» solo si de verdad queda un día de cron antes del
 * vencimiento. Si no, se le dice la verdad ya —que se apagó, y que renueve él—
 * en vez de dejarlo esperar un intento que no va a llegar.
 */
export function decidirTrasRechazo(input: {
  clase: ClaseCobro
  rechazosEnCiclo: number
  ahora: Date
  vencimiento: Date
  politica?: Pick<typeof POLITICA_RENOVACION, 'maxRechazosPorCiclo' | 'horizonteDeReintentoMs'>
}): DecisionTrasRechazo {
  const politica = input.politica ?? POLITICA_RENOVACION
  if (input.clase === 'rechazo_definitivo') return { accion: 'desactivar', causa: 'definitivo' }
  if (input.rechazosEnCiclo >= politica.maxRechazosPorCiclo) {
    return { accion: 'desactivar', causa: 'agotado' }
  }
  if (input.ahora.getTime() + politica.horizonteDeReintentoMs > input.vencimiento.getTime()) {
    return { accion: 'desactivar', causa: 'sin_tiempo' }
  }
  return { accion: 'reintentar' }
}
