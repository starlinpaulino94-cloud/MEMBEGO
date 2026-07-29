/**
 * EVENTOS ESTRUCTURADOS (auditoría de producción · A-09, Fase 6).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ ESTABA MAL
 *
 * Los logs de MembeGo eran frases. `console.error('[canje] falló', e)`. Sirven
 * para leer un incidente concreto y no sirven para NADA más: no se pueden
 * contar, no se pueden agrupar, no se puede saber si hoy hay más canjes
 * fallidos que ayer. Cuando el hallazgo A-09 decía "una degradación se detecta
 * cuando los usuarios se quejan", esto era la mitad del motivo.
 *
 * Un evento estructurado es una línea de JSON con forma fija. Vercel, Sentry y
 * cualquier recolector de logs saben filtrarla y contarla. Deja de ser prosa y
 * pasa a ser un dato.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA DECISIÓN QUE MÁS IMPORTA: QUÉ **NO** SE PUEDE ESCRIBIR AQUÍ
 *
 * Los logs son el sitio por donde los datos personales se escapan sin que nadie
 * lo note. No hay una brecha, no hay un atacante: alguien añade el correo al
 * mensaje "para depurar más fácil" y seis meses después los correos de 100.000
 * clientes llevan un año en un proveedor de logs con otros permisos, otra
 * retención y otro país.
 *
 * Por eso `extra` NO acepta cadenas libres. Acepta números, booleanos y
 * *etiquetas*: cadenas cortas de `[a-z0-9_-]`. Un correo no cabe en esa forma.
 * Un teléfono tampoco. Un token tampoco. No es una lista de cosas prohibidas
 * —esas siempre se quedan cortas— sino una forma que solo admite lo que sí
 * queremos.
 *
 * Tampoco se registran identificadores de persona. `companyId` sí, porque sin
 * saber qué empresa falla no se puede diagnosticar nada multi-inquilino; pero
 * un `userId` junto a una marca de tiempo identifica a alguien de forma
 * trivial, y los logs los ve más gente y durante más tiempo que la base de
 * datos. Para el detalle de un error concreto ya está Sentry, que tiene control
 * de acceso y retención propios.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Dominios del negocio. Fijos a propósito: un dominio nuevo se piensa. */
export type DominioEvento =
  | 'escaneo'
  | 'pago'
  | 'registro'
  | 'cola'
  | 'auth'
  | 'datos'
  | 'sistema'

/** Valores admitidos en `extra`. Ver la cabecera: no hay cadenas libres. */
export type ValorEtiqueta = number | boolean | string

export interface Evento {
  dominio: DominioEvento
  /** Qué ocurrió, en etiqueta: `canje`, `intento_creado`, `lote_enviado`. */
  accion: string
  /** ¿Salió bien? Es el campo que permite calcular los SLO. */
  ok: boolean
  /** Duración en milisegundos, si se midió. */
  ms?: number
  /** Empresa afectada. Sin esto no se puede diagnosticar nada multi-inquilino. */
  companyId?: string | null
  /** Por qué falló, en etiqueta: `token_vencido`, `sin_saldo`, `p2024`. */
  motivo?: string
  /** Dimensiones adicionales. Solo números, booleanos y etiquetas. */
  extra?: Record<string, ValorEtiqueta>
}

/**
 * Forma de una etiqueta: empieza por LETRA minúscula, sigue con minúsculas,
 * dígitos, guion y guion bajo, hasta 48 caracteres.
 *
 * Lo de "empieza por letra" no es cosmético y lo descubrió una prueba: con la
 * versión anterior —que solo pedía `[a-z0-9_-]`— un teléfono dominicano
 * escrito `809-555-1234` PASABA el filtro. Son dígitos y guiones, exactamente
 * lo permitido. Exigir que empiece por letra descarta teléfonos, cédulas,
 * fechas e identificadores numéricos de un plumazo, y ninguna etiqueta real
 * (`qr_ya_usado`, `p2024`, `pool_agotado`) empieza por dígito.
 */
const RE_ETIQUETA = /^[a-z][a-z0-9_-]{0,47}$/

/** Siete dígitos seguidos ya no es un código: es un número que identifica algo. */
const RE_DIGITOS_LARGOS = /\d{7,}/

/**
 * ¿Es esto una etiqueta y no un dato personal disfrazado?
 *
 * Sin arroba, sin espacios, sin puntos: ni un correo ni una URL ni un mensaje
 * de error crudo pasan por aquí. Y tampoco un número largo incrustado dentro
 * de algo que sí empieza por letra (`tel8095551234`).
 */
export function esEtiqueta(v: unknown): v is string {
  return typeof v === 'string' && RE_ETIQUETA.test(v) && !RE_DIGITOS_LARGOS.test(v)
}

/**
 * Normaliza cualquier texto a etiqueta. Lo que no encaje se recorta y se
 * limpia; si no queda nada utilizable, `desconocido`.
 *
 * Existe para el caso real: un `catch` tiene un mensaje de error largo y quien
 * escribe el código quiere clasificarlo. Mejor darle una herramienta que lo
 * convierta en etiqueta que dejar que meta el mensaje entero.
 */
export function aEtiqueta(texto: unknown): string {
  if (typeof texto !== 'string') return 'desconocido'
  const limpio = texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)
    .replace(/_+$/, '')
  return limpio.length > 0 ? limpio : 'desconocido'
}

/** Deja en `extra` solo lo que tiene forma admitida. */
export function saneaExtra(
  extra: Record<string, unknown> | undefined
): Record<string, ValorEtiqueta> | undefined {
  if (!extra) return undefined
  const salida: Record<string, ValorEtiqueta> = {}
  for (const [clave, valor] of Object.entries(extra)) {
    if (!esEtiqueta(clave)) continue
    if (typeof valor === 'number' && Number.isFinite(valor)) salida[clave] = valor
    else if (typeof valor === 'boolean') salida[clave] = valor
    else if (esEtiqueta(valor)) salida[clave] = valor
    // Cualquier otra cosa se descarta EN SILENCIO y a propósito: avisar de que
    // se descartó un valor invitaría a "arreglarlo" metiéndolo por otra vía.
  }
  return Object.keys(salida).length > 0 ? salida : undefined
}

/**
 * La línea que se escribe. Función pura para poder probarla: lo que se prueba
 * de verdad aquí es que los datos personales NO salen.
 *
 * El prefijo `evt` es lo que permite filtrar estas líneas entre todo el ruido
 * de un log de Vercel: `evt` y ya está.
 */
export function lineaDeEvento(e: Evento, ahora: Date = new Date()): string {
  const cuerpo: Record<string, unknown> = {
    evt: 1,
    t: ahora.toISOString(),
    dom: e.dominio,
    acc: aEtiqueta(e.accion),
    ok: e.ok === true,
  }
  if (typeof e.ms === 'number' && Number.isFinite(e.ms)) cuerpo.ms = Math.round(e.ms)
  if (e.companyId) cuerpo.emp = e.companyId
  if (e.motivo) cuerpo.motivo = aEtiqueta(e.motivo)

  const extra = saneaExtra(e.extra)
  if (extra) Object.assign(cuerpo, extra)

  return JSON.stringify(cuerpo)
}

/**
 * Escribe el evento.
 *
 * A `console.log` y no a un servicio: en Vercel la salida estándar ya se
 * recoge, se conserva y se puede derivar a un recolector externo sin tocar el
 * código. Mandar cada evento por red desde una función serverless añadiría
 * latencia a la petición del usuario para ganar exactamente nada.
 *
 * `console.log` y no `console.error` incluso cuando `ok` es false: un evento
 * de negocio fallido —un QR vencido, una tarjeta rechazada— es información
 * normal, no un error del sistema. Mezclarlos hace que el panel de errores se
 * llene de cosas que funcionan como deben.
 *
 * Nunca lanza: la observabilidad no puede tumbar lo que observa.
 */
export function registrarEvento(e: Evento): void {
  try {
    // La regla `no-console` del proyecto solo admite `warn` y `error`, y existe
    // para que nadie deje `console.log` de depuración por ahí. Este es el caso
    // que la regla no contempla: una salida estructurada, deliberada y con
    // formato fijo. Usar `warn` o `error` para esquivar el linter llenaría el
    // panel de errores de eventos que describen el sistema funcionando bien.
    // eslint-disable-next-line no-console
    console.log(lineaDeEvento(e))
  } catch {
    /* si ni siquiera se puede serializar, se pierde el evento y ya está */
  }
}

/**
 * Ejecuta algo midiendo cuánto tarda y emitiendo el evento.
 *
 * Devuelve lo que devuelva la función y **relanza** cualquier error tras
 * registrarlo: envolver una operación para observarla no puede cambiar su
 * comportamiento.
 */
export async function medir<T>(
  base: Omit<Evento, 'ok' | 'ms'>,
  fn: () => Promise<T>
): Promise<T> {
  const t0 = Date.now()
  try {
    const r = await fn()
    registrarEvento({ ...base, ok: true, ms: Date.now() - t0 })
    return r
  } catch (e) {
    registrarEvento({
      ...base,
      ok: false,
      ms: Date.now() - t0,
      motivo: base.motivo ?? aEtiqueta(e instanceof Error ? e.name : 'error'),
    })
    throw e
  }
}
