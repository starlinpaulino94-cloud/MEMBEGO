import type { CausaDeCierre } from '@/modules/pagos/renovacionPolitica'

/**
 * AVISOS AL CLIENTE sobre la renovación automática — los textos, sin envío.
 *
 * Sin Prisma ni Next: se prueba con valores (`tests/avisos-renovacion.test.ts`).
 * Quién avisa, cuándo y sin repetirse está en `avisosRenovacion.ts`.
 *
 * REGLA DE ESTOS TEXTOS: NO AFIRMAN LO QUE NO SE SABE.
 *
 *  · «No se hizo ningún cargo» solo se dice de un rechazo REAL (el banco o la
 *    pasarela dijeron que no). Un cobro que se cayó sin respuesta no genera
 *    aviso: no se sabe si se cobró, y avisar «no se cobró» podría ser mentira.
 *  · «Lo volveremos a intentar» solo se dice si de verdad queda un día de cron
 *    antes del vencimiento (`decidirTrasRechazo`). Si no, el aviso es el de cierre.
 *  · No se cita nada de la tarjeta salvo marca y últimos 4, que es lo que ya ve
 *    el cliente en «Mis tarjetas».
 */

const TZ = 'America/Santo_Domingo'

export type TipoAviso =
  | 'renovacion_proxima'
  | 'rechazo_con_reintento'
  | 'rechazo_final'
  /** Aviso PREVIO: cuando toque cobrar, la tarjeta ya estará vencida. */
  | 'tarjeta_no_servira'
  /** Cierre en el momento del cobro: la tarjeta está vencida y no se intentó. */
  | 'tarjeta_vencida'

export interface DatosAviso {
  empresa: string
  /** Nombre de pila, para el saludo. */
  cliente: string
  plan: string
  monto: number
  /** «Visa ····4242», de `etiquetaTarjeta`. */
  tarjeta: string
  /** Vencimiento de la MEMBRESÍA. */
  vence: Date
  membershipId: string
  /** El motivo del rechazo, ya traducido para el cliente (`mensajeCompra`). */
  motivo?: string | null
  /** Por qué se apagó la renovación (solo `rechazo_final`). */
  causa?: CausaDeCierre
  /** Cuántos intentos se hicieron en el ciclo (solo `rechazo_final`). */
  intentos?: number
  /** Vencimiento de la TARJETA, «08/27». Solo si se conoce. */
  tarjetaVence?: string | null
  /**
   * La tarjeta sirve para esta renovación pero vence antes de la SIGUIENTE. Añade
   * un párrafo al aviso normal en vez de mandar un segundo correo.
   */
  tarjetaVenceAntesDeLaSiguiente?: boolean
  /** La renovación se activó antes de que se registrara el consentimiento. */
  heredado?: boolean
}

export type TipoNotificacion = 'MEMBRESIA_POR_VENCER' | 'PAGO_RECHAZADO' | 'SISTEMA'

export interface AvisoRedactado {
  tipoNotificacion: TipoNotificacion
  /** Título de la notificación en la app. */
  titulo: string
  /** Texto corto de la notificación en la app. */
  mensaje: string
  asunto: string
  /** Los párrafos del correo, sin HTML. */
  parrafos: string[]
  /** Texto del botón del correo. */
  boton: string
  /** Ruta a la que lleva la notificación y el botón. */
  href: string
  /** `alerta` pinta el correo en ámbar; `info`, en verde. */
  tono: 'info' | 'alerta'
}

export function fechaLarga(fecha: Date): string {
  return new Intl.DateTimeFormat('es-DO', { timeZone: TZ, dateStyle: 'long' }).format(fecha)
}

/** «RD$1,600.00». Mismo formato que el recibo de pago. */
export function montoRD(monto: number): string {
  return `RD$${monto.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Asegura que una frase termine en punto: los motivos del banco vienen con y sin. */
function conPunto(frase: string): string {
  const limpia = frase.trim()
  return /[.!?]$/.test(limpia) ? limpia : `${limpia}.`
}

// ── Cómo se NOMBRA una tarjeta en un aviso ──────────────────────────────────
//
// Solo marca y últimos 4: lo que permite que el cliente la reconozca y nada con
// lo que se pueda cobrar.

const MARCAS: Readonly<Record<string, string>> = {
  VISA: 'Visa',
  MASTERCARD: 'Mastercard',
  MC: 'Mastercard',
  AMEX: 'American Express',
  AMERICANEXPRESS: 'American Express',
  DISCOVER: 'Discover',
}

/** «VISA» → «Visa». Una marca que no se conoce se capitaliza; una vacía es «Tarjeta». */
export function nombreMarca(marca: string | null | undefined): string {
  const limpia = marca?.trim()
  if (!limpia) return 'Tarjeta'
  const clave = limpia.toUpperCase().replace(/[\s_-]/g, '')
  return MARCAS[clave] ?? limpia.charAt(0).toUpperCase() + limpia.slice(1).toLowerCase()
}

/** «Visa ····1234». Sin últimos 4 (o con algo que no son 4 dígitos), «Visa guardada»: no se inventa un número. */
export function etiquetaTarjeta(
  marca: string | null | undefined,
  ultimos4: string | null | undefined
): string {
  const digitos = (ultimos4 ?? '').replace(/\D/g, '')
  return digitos.length >= 4
    ? `${nombreMarca(marca)} ····${digitos.slice(-4)}`
    : `${nombreMarca(marca)} guardada`
}

/** «08/27», o `null` si no hay un vencimiento utilizable. El año acepta dos o cuatro dígitos. */
export function formatoVencimiento(
  mes: number | null | undefined,
  anio: number | null | undefined
): string | null {
  if (typeof mes !== 'number' || typeof anio !== 'number') return null
  if (!Number.isInteger(mes) || !Number.isInteger(anio) || mes < 1 || mes > 12) return null
  const completo = anio >= 0 && anio < 100 ? 2000 + anio : anio
  if (completo < 2000 || completo > 2100) return null
  return `${String(mes).padStart(2, '0')}/${String(completo % 100).padStart(2, '0')}`
}

const MOTIVO_GENERICO = 'El pago no se pudo completar.'

export function redactarAviso(tipo: TipoAviso, d: DatosAviso): AvisoRedactado {
  const href = `/membresia/${d.membershipId}`
  const vence = fechaLarga(d.vence)
  const monto = montoRD(d.monto)
  const motivo = conPunto(d.motivo?.trim() || MOTIVO_GENERICO)
  const hola = `Hola ${d.cliente},`

  switch (tipo) {
    case 'renovacion_proxima': {
      const parrafos = [
        hola,
        `Tu membresía «${d.plan}» en ${d.empresa} vence el ${vence}. Para que no se interrumpa, la renovaremos automáticamente: en los días previos al vencimiento cobraremos ${monto} a tu ${d.tarjeta}.`,
        'Si no quieres que se renueve, o prefieres otra forma de pago, puedes cambiarlo desde tu membresía antes de esa fecha.',
      ]
      if (d.tarjetaVenceAntesDeLaSiguiente && d.tarjetaVence) {
        parrafos.push(
          `Ten en cuenta que tu tarjeta tiene vencimiento ${d.tarjetaVence}, antes de la renovación siguiente. Registra una tarjeta vigente cuando renueves para que la renovación automática no se interrumpa.`
        )
      }
      // Las renovaciones que ya existían se heredaron sin constancia de lo que el
      // cliente vio. Este aviso es la ocasión de que lo revise, sin más trámite.
      if (d.heredado) {
        parrafos.push(
          'Esta renovación automática se activó antes de que registráramos tu autorización por separado. Si no la recuerdas o ya no la quieres, desactívala desde tu membresía.'
        )
      }
      return {
        tipoNotificacion: 'MEMBRESIA_POR_VENCER',
        titulo: 'Tu membresía se renovará automáticamente',
        mensaje: `«${d.plan}» vence el ${vence}. Cobraremos ${monto} a tu ${d.tarjeta} en los días previos.`,
        asunto: `Tu membresía en ${d.empresa} se renovará automáticamente`,
        parrafos,
        boton: 'Ver mi membresía',
        href,
        tono: 'info',
      }
    }

    case 'rechazo_con_reintento':
      return {
        tipoNotificacion: 'PAGO_RECHAZADO',
        titulo: 'No pudimos renovar tu membresía',
        mensaje: `${motivo} No se hizo ningún cargo. Volveremos a intentarlo antes del ${vence}.`,
        asunto: `No pudimos renovar tu membresía en ${d.empresa}`,
        parrafos: [
          hola,
          `Intentamos renovar tu membresía «${d.plan}» con tu ${d.tarjeta} por ${monto}, pero el pago no se completó. ${motivo} No se hizo ningún cargo.`,
          `Volveremos a intentarlo automáticamente en las próximas 24 horas, antes de que tu membresía venza el ${vence}. Si prefieres no esperar, puedes pagar ahora desde tu membresía.`,
        ],
        boton: 'Pagar ahora',
        href,
        tono: 'alerta',
      }

    case 'rechazo_final': {
      const porQue =
        d.causa === 'definitivo'
          ? 'Con esta tarjeta no se va a poder cobrar, así que no tiene sentido volver a intentarlo.'
          : d.causa === 'agotado'
            ? `Lo intentamos ${d.intentos ?? 'varias'} veces sin éxito.`
            : 'Ya no queda tiempo para otro intento antes de que venza tu membresía.'
      return {
        tipoNotificacion: 'PAGO_RECHAZADO',
        titulo: 'Desactivamos la renovación automática',
        mensaje: `No pudimos cobrar tu ${d.tarjeta}. Tu membresía sigue vigente hasta el ${vence}: renuévala para no perderla.`,
        asunto: `Desactivamos la renovación automática de tu membresía en ${d.empresa}`,
        parrafos: [
          hola,
          `No pudimos renovar tu membresía «${d.plan}» con tu ${d.tarjeta} por ${monto}. ${motivo} No se hizo ningún cargo.`,
          `${porQue} Por eso desactivamos la renovación automática: no vamos a seguir intentando cobrar tu tarjeta. Sigue guardada, y puedes quitarla cuando quieras desde Mis tarjetas.`,
          `Tu membresía sigue vigente hasta el ${vence}. Para continuar sin interrupción, renuévala desde tu membresía antes de esa fecha.`,
        ],
        boton: 'Renovar mi membresía',
        href,
        tono: 'alerta',
      }
    }

    case 'tarjeta_no_servira': {
      const venc = d.tarjetaVence ? ` (vencimiento ${d.tarjetaVence})` : ''
      return {
        tipoNotificacion: 'SISTEMA',
        titulo: 'Tu tarjeta guardada no servirá para renovar',
        mensaje: `Con el vencimiento de tu ${d.tarjeta}${venc} no podremos cobrar la renovación de «${d.plan}». Renueva con una tarjeta vigente antes del ${vence}.`,
        asunto: `Tu tarjeta guardada en ${d.empresa} no servirá para renovar`,
        parrafos: [
          hola,
          `Tu membresía «${d.plan}» en ${d.empresa} vence el ${vence} y estaba lista para renovarse sola con tu ${d.tarjeta}${venc}. Cuando toque cobrar, esa tarjeta ya estará vencida y no podremos usarla.`,
          'Para que tu membresía no se interrumpa, renuévala desde tu membresía con una tarjeta vigente antes de esa fecha.',
        ],
        boton: 'Renovar mi membresía',
        href,
        tono: 'alerta',
      }
    }

    case 'tarjeta_vencida':
      return {
        tipoNotificacion: 'PAGO_RECHAZADO',
        titulo: 'Tu tarjeta está vencida',
        mensaje: `No intentamos cobrar tu ${d.tarjeta} porque está vencida. Desactivamos la renovación automática; tu membresía sigue vigente hasta el ${vence}.`,
        asunto: `Tu tarjeta guardada en ${d.empresa} está vencida`,
        parrafos: [
          hola,
          `Tu ${d.tarjeta} está vencida, así que no intentamos cobrar la renovación de tu membresía «${d.plan}». No se hizo ningún cargo.`,
          `Desactivamos la renovación automática. Tu membresía sigue vigente hasta el ${vence}: para continuar sin interrupción, renuévala desde tu membresía con una tarjeta vigente.`,
        ],
        boton: 'Renovar mi membresía',
        href,
        tono: 'alerta',
      }
  }
}

/**
 * IDENTIDAD DE CADA AVISO, para que un cron que corre a diario no lo repita.
 *
 * Es la `dedupeKey` de la notificación (única por usuario): el que la inserta
 * primero es el dueño del aviso, y el resto ve que ya existe. Cada clave dice a
 * qué hecho pertenece: el ciclo de una membresía, un intento concreto, o un
 * vencimiento de tarjeta. Dos hechos distintos nunca comparten clave; el mismo
 * hecho, siempre.
 */
export const clavesDeAviso = {
  /** Uno por ciclo de renovación: la fecha de vencimiento lo identifica. */
  renovacionProxima: (membershipId: string, cicloClave: string) =>
    `renovacion-proxima:${membershipId}:${cicloClave}`,
  /** Uno por intento rechazado: el intento es el hecho. */
  rechazo: (intentoId: string) => `renovacion-rechazo:${intentoId}`,
  /** Uno por ciclo y membresía. */
  tarjetaNoServira: (membershipId: string, cicloClave: string) =>
    `tarjeta-no-servira:${membershipId}:${cicloClave}`,
  /** Uno por ciclo y membresía. */
  tarjetaVencida: (membershipId: string, cicloClave: string) =>
    `tarjeta-vencida:${membershipId}:${cicloClave}`,
}
