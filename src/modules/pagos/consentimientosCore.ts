import { esIpValida } from '@/lib/payments/cardnet-tokens-core'

/**
 * NÚCLEO PURO del registro de consentimientos sobre la tarjeta.
 *
 * Son DOS consentimientos, y no son lo mismo:
 *
 *  · GUARDAR_TARJETA — «guarda mi tarjeta». Permite que el cliente pague de
 *    nuevo sin escribirla, con él delante.
 *  · RENOVACION_AUTOMATICA — «cóbrame sola cada período». Permite cobros SIN el
 *    cliente. Es lo más delicado que se le puede pedir a alguien sobre su
 *    tarjeta, y exige tener la tarjeta guardada, pero NO se deduce de ella: el
 *    permiso de guardar dice, a propósito, que «no activa renovaciones
 *    automáticas».
 */

export const TIPOS_CONSENTIMIENTO = ['GUARDAR_TARJETA', 'RENOVACION_AUTOMATICA'] as const
export type TipoConsentimiento = (typeof TIPOS_CONSENTIMIENTO)[number]

export const ORIGENES_CONSENTIMIENTO = ['CLIENTE', 'HEREDADO'] as const
export type OrigenConsentimiento = (typeof ORIGENES_CONSENTIMIENTO)[number]

export function esTipoConsentimiento(valor: unknown): valor is TipoConsentimiento {
  return typeof valor === 'string' && (TIPOS_CONSENTIMIENTO as readonly string[]).includes(valor)
}

/**
 * `textoVersion` de los consentimientos heredados: la tarjeta o la renovación
 * existían antes de que hubiera este registro. No hay texto exacto, y fingir lo
 * contrario sería fabricar evidencia.
 */
export const TEXTO_VERSION_HEREDADO = 'previo-a-registro'

// ── Los textos ──────────────────────────────────────────────────────────────
//
// UNA VERSIÓN PUBLICADA NO SE EDITA. El registro dice «el cliente aceptó la
// versión X», y X tiene que significar siempre lo mismo. Si el texto cambia, se
// añade una versión nueva.
//
// LA PANTALLA Y EL REGISTRO LEEN DE AQUÍ. Lo que se muestra no puede diferir de
// lo que se anota. La interfaz web renderiza estos textos; la app móvil (Expo)
// tiene los suyos en su propio paquete, así que su texto se copia tal cual y una
// prueba compara los dos (`tests/consentimientos-pago.test.ts`).
//
// Llevan marcas `{empresa}`, `{monto}` y `{periodo}` que rellena
// `renderizarTexto`. Lo que se registra es la VERSIÓN de la plantilla; los
// valores concretos salen de la membresía en ese momento.
//
// NO prometas aquí nada que el sistema no haga. El texto de renovar es CORTO a
// propósito (decisión del dueño, 21-10-2026): lo que el cliente acepta es el
// cobro sin confirmar y las condiciones de la Política de pagos
// (`/privacy#renovacion-automatica`), que es donde están escritas, completas, las
// promesas: aviso antes de cada cobro, hasta N intentos, qué pasa si se rechaza.
// Esas promesas valen igual que si estuvieran aquí: el cobro se niega a salir
// sin el aviso (`exigeAvisoPrevio`) y una prueba obliga a que las cifras de la
// política pública sean las de `POLITICA_RENOVACION`.

/** El permiso de guardar, tal como lo muestra la pantalla de pago WEB. */
export const TEXTO_VERSION_GUARDAR_WEB = 'guardar-tarjeta-web-v1'
/** El permiso de guardar, tal como lo muestra la app móvil. */
export const TEXTO_VERSION_GUARDAR_MOVIL = 'guardar-tarjeta-movil-v1'
/**
 * El texto de renovar automáticamente, el que muestra el panel «Renovación
 * automática» de la membresía. BORRADOR mientras esa pantalla no se despliegue
 * (nadie lo ha aceptado); desde el primer despliegue es una versión publicada y
 * cualquier cambio es `renovacion-v2`.
 */
export const TEXTO_VERSION_RENOVACION = 'renovacion-v1'

export const TEXTOS_PUBLICADOS: Readonly<Record<string, string>> = {
  [TEXTO_VERSION_GUARDAR_WEB]:
    'Guardar esta tarjeta para futuras compras. CardNET conserva el perfil de pago de forma segura. Este permiso no activa renovaciones automáticas.',
  [TEXTO_VERSION_GUARDAR_MOVIL]:
    'Guardar esta tarjeta para futuras compras. Tu tarjeta se guardará de forma segura en CardNET. Este permiso no activa renovaciones automáticas.',
  [TEXTO_VERSION_RENOVACION]:
    'Renovar mi membresía automáticamente. Autorizo a {empresa} a cobrar a esta tarjeta el precio vigente del plan (hoy {monto}) {periodo}, sin confirmar cada cobro, según las condiciones de renovación automática de la Política de pagos. Puedo desactivarlo cuando quiera.',
}

/** La sección de la Política de pagos que el texto de renovar incorpora. */
export const RUTA_POLITICA_RENOVACION = '/privacy#renovacion-automatica'

/**
 * Las versiones cuyo texto PROMETE un aviso antes de cada cobro, directamente o
 * por la Política de pagos que incorporan («según las condiciones de…»).
 *
 * Es la otra mitad de la promesa: un consentimiento que dice «me avisarán» solo
 * es verdad si el cobro no sale cuando no se pudo avisar. El cobro con tarjeta
 * guardada consulta esto (`exigeAvisoPrevio`) y, si la versión que aceptó el
 * cliente está aquí y no consta el aviso del ciclo, NO cobra.
 *
 * Los consentimientos HEREDADOS nunca lo prometieron, y exigírselo ahora les
 * detendría renovaciones que hoy funcionan. Una prueba obliga a que esta lista
 * coincida con los textos que de verdad hablan de avisos.
 */
const VERSIONES_CON_AVISO_PREVIO: ReadonlySet<string> = new Set([TEXTO_VERSION_RENOVACION])

/** ¿Prometió el texto que aceptó el cliente un aviso antes de cada cobro? */
export function exigeAvisoPrevio(textoVersion: string | null | undefined): boolean {
  return typeof textoVersion === 'string' && VERSIONES_CON_AVISO_PREVIO.has(textoVersion)
}

export interface ValoresTexto {
  empresa?: string | null
  /** Con símbolo y formato de la empresa: «RD$1,600». */
  monto?: string | null
  /** «cada 30 días». */
  periodo?: string | null
}

/**
 * El texto TAL COMO SE MUESTRA, con sus marcas rellenas.
 *
 * Lanza si la versión no existe: mostrar un texto y registrar otro es el fallo
 * que todo este módulo existe para impedir, y un `undefined` en la pantalla sería
 * la peor forma de enterarse. Si falta un valor, se usa una frase neutra en vez
 * de dejar una llave a la vista.
 */
export function renderizarTexto(version: string, valores: ValoresTexto = {}): string {
  const plantilla = TEXTOS_PUBLICADOS[version]
  if (!plantilla) throw new Error(`renderizarTexto: la versión «${version}» no existe.`)
  const relleno: Record<string, string> = {
    empresa: valores.empresa?.trim() || 'esta empresa',
    monto: valores.monto?.trim() || 'el precio de tu plan',
    periodo: valores.periodo?.trim() || 'en cada período',
  }
  return plantilla.replace(/\{(empresa|monto|periodo)\}/g, (_, clave: string) => relleno[clave])
}

/**
 * «cada 30 días» a partir de la vigencia del plan. `null` si no se conoce: el
 * texto usa entonces «en cada período» en vez de inventar un número.
 *
 * Es lo que el cobro hace de verdad: cada renovación extiende `vigenciaDias`.
 */
export function periodoDelPlan(vigenciaDias: number | null | undefined): string | null {
  if (!vigenciaDias || !Number.isInteger(vigenciaDias) || vigenciaDias < 1) return null
  return vigenciaDias === 1 ? 'cada día' : `cada ${vigenciaDias} días`
}

/**
 * Parte un texto en su PRIMERA FRASE (el título de la casilla) y el resto (el
 * detalle). Los textos se escriben con la idea por delante: «Guardar esta
 * tarjeta para futuras compras. CardNET conserva…».
 *
 * No se inventa nada: título + detalle es el texto original, partido. Quien
 * pinte la casilla no puede mostrar menos de lo que se registra.
 */
export function partirTexto(texto: string): { titulo: string; detalle: string } {
  const i = texto.indexOf('. ')
  if (i < 0) return { titulo: texto, detalle: '' }
  return { titulo: texto.slice(0, i + 1), detalle: texto.slice(i + 2) }
}

/** Lo que el cliente vio y de dónde aceptó. Lo aportan las rutas, que son quienes tienen la petición. */
export interface ContextoConsentimiento {
  textoVersion: string
  ip?: string | null
  userAgent?: string | null
}

/**
 * La IP que vale la pena guardar. `getClientIdentifier` devuelve la cadena
 * `'unknown'` cuando la petición no trae `x-forwarded-for`: guardarla como si
 * fuera una IP sería dejar un dato falso en un registro cuyo único valor es ser
 * verdadero.
 */
export function ipParaRegistro(ip: string | null | undefined): string | null {
  const v = ip?.trim()
  return v && esIpValida(v) ? v : null
}

/** Cabeceras largas o manipuladas no deben inflar el registro. */
export function userAgentParaRegistro(ua: string | null | undefined): string | null {
  const v = ua?.trim()
  return v ? v.slice(0, 300) : null
}
