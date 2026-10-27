/**
 * LOS TEXTOS DE CONSENTIMIENTO DE IDENTIDAD y sus versiones.
 *
 * Núcleo puro, igual que `modules/pagos/consentimientosCore.ts`: la pantalla web,
 * la app móvil y el servidor leen de AQUÍ, así que lo que se muestra no puede
 * diferir de lo que se registra. Lo que se registra es la VERSIÓN del texto; el
 * texto de una versión publicada NO se edita (cambiarlo es una versión nueva).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ESTADO: BORRADOR PENDIENTE DE REVISIÓN LEGAL.
 * Ninguna pantalla los muestra todavía (la experiencia de cliente es la Fase 3),
 * así que mientras tanto se pueden ajustar. Desde la primera vez que se muestren
 * a una persona real pasan a ser versiones publicadas. Nada de esto se muestra
 * con documentos reales hasta el dictamen legal (docs/identidad/AUDITORIA…,
 * decisión 11).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TRES CONSENTIMIENTOS, TRES CASILLAS, NINGUNA VIENE MARCADA
 *
 *  · IDENTIDAD_BIOMETRIA cubre las TRES condiciones del art. 58 de la Ley 4-23:
 *    (1) se informa que se capturan datos biométricos, (2) el propósito específico
 *    y el plazo, y (3) el consentimiento es explícito, libre, específico, informado
 *    e inequívoco (casilla propia, no agrupada con nada más).
 *  · IDENTIDAD_TRANSFERENCIA_INTERNACIONAL cubre el art. 80.1 de la Ley 172-13: el
 *    proveedor procesa los datos fuera del país.
 *  · IDENTIDAD_DIVULGACION_EMPRESAS es opcional: sin él la verificación sirve a
 *    MEMBEGO, pero las empresas donde la persona es cliente no ven nada.
 *
 * NO PROMETAS AQUÍ NADA QUE EL SISTEMA NO HAGA. El plazo de «3 años» es
 * `POLITICA_IDENTIDAD.validezMeses / 12` y una prueba obliga a que coincidan.
 */

export const TIPOS_CONSENTIMIENTO_IDENTIDAD = [
  'IDENTIDAD_BIOMETRIA',
  'IDENTIDAD_TRANSFERENCIA_INTERNACIONAL',
  'IDENTIDAD_DIVULGACION_EMPRESAS',
] as const
export type TipoConsentimientoIdentidad = (typeof TIPOS_CONSENTIMIENTO_IDENTIDAD)[number]

export function esTipoConsentimientoIdentidad(valor: unknown): valor is TipoConsentimientoIdentidad {
  return typeof valor === 'string' && (TIPOS_CONSENTIMIENTO_IDENTIDAD as readonly string[]).includes(valor)
}

export const CANALES_CONSENTIMIENTO_IDENTIDAD = ['web', 'movil', 'soporte'] as const
export type CanalConsentimientoIdentidad = (typeof CANALES_CONSENTIMIENTO_IDENTIDAD)[number]

/**
 * Los consentimientos SIN los que no se captura nada. La divulgación a empresas
 * no está: sin ella se puede verificar, solo que las empresas no ven el resultado.
 */
export const TIPOS_REQUERIDOS_PARA_CAPTURAR: readonly TipoConsentimientoIdentidad[] = [
  'IDENTIDAD_BIOMETRIA',
  'IDENTIDAD_TRANSFERENCIA_INTERNACIONAL',
]

export const TEXTO_VERSION_BIOMETRIA = 'identidad-biometria-v1'
export const TEXTO_VERSION_TRANSFERENCIA = 'identidad-transferencia-v1'
export const TEXTO_VERSION_DIVULGACION = 'identidad-divulgacion-v1'

/** La versión vigente de cada tipo: la que la pantalla muestra y la que se registra. */
export const VERSION_VIGENTE: Readonly<Record<TipoConsentimientoIdentidad, string>> = {
  IDENTIDAD_BIOMETRIA: TEXTO_VERSION_BIOMETRIA,
  IDENTIDAD_TRANSFERENCIA_INTERNACIONAL: TEXTO_VERSION_TRANSFERENCIA,
  IDENTIDAD_DIVULGACION_EMPRESAS: TEXTO_VERSION_DIVULGACION,
}

/** La sección de la Política de Privacidad que estos textos incorporan. */
export const RUTA_POLITICA_IDENTIDAD = '/privacy#verificacion-identidad'

/**
 * Las plantillas llevan la marca `{proveedor}` (el nombre del proveedor de
 * verificación), que rellena `renderizarTexto`.
 */
export const TEXTOS_PUBLICADOS: Readonly<Record<string, string>> = {
  [TEXTO_VERSION_BIOMETRIA]:
    'Verificar mi identidad con mi cédula y una selfie. Autorizo a MembeGo, a través de {proveedor}, a capturar la foto de mi cédula y una selfie, y a generar con ellas datos biométricos de mi rostro para compararlo con el del documento y comprobar que estoy presente. Los usan únicamente para verificar que soy el titular del documento y prevenir fraude y robo de identidad. {proveedor} elimina las imágenes y los datos biométricos al concluir la verificación; MembeGo conserva solo el resultado (si estoy verificado, el nivel y la fecha) durante 3 años, hasta que deba revalidarlo o hasta que yo pida borrarlo. Puedo retirar este permiso cuando quiera.',
  [TEXTO_VERSION_TRANSFERENCIA]:
    'Aceptar que {proveedor} procese mis datos en la Unión Europea. Entiendo que, para esta verificación, {proveedor} trata mis datos fuera de la República Dominicana, por cuenta de MembeGo y bajo un contrato que le exige seguridad, secreto y borrado, y autorizo esa transferencia.',
  [TEXTO_VERSION_DIVULGACION]:
    'Permitir que las empresas donde soy cliente vean si mi identidad está verificada. Esas empresas verán únicamente que estoy verificado y desde cuándo; nunca mi cédula, mi selfie ni mi número de documento. Puedo retirar este permiso cuando quiera.',
}

export interface ValoresTextoIdentidad {
  /** El nombre del proveedor de verificación tal como se le muestra a la persona. */
  proveedor?: string | null
}

/**
 * El texto TAL COMO SE MUESTRA, con la marca rellena. Lanza si la versión no
 * existe: mostrar un texto y registrar otro es el fallo que todo este módulo
 * existe para impedir, y un `undefined` en pantalla sería mentir a la persona.
 */
export function renderizarTextoIdentidad(version: string, valores: ValoresTextoIdentidad = {}): string {
  const plantilla = TEXTOS_PUBLICADOS[version]
  if (!plantilla) throw new Error(`renderizarTextoIdentidad: la versión «${version}» no existe.`)
  const proveedor = valores.proveedor?.trim() || 'el proveedor de verificación'
  return plantilla.replace(/\{proveedor\}/g, proveedor)
}

/**
 * Parte un texto en su PRIMERA FRASE (el título de la casilla) y el resto. Título
 * + detalle es el texto original, partido: quien pinte la casilla no puede mostrar
 * menos de lo que se registra.
 */
export function partirTextoIdentidad(texto: string): { titulo: string; detalle: string } {
  const i = texto.indexOf('. ')
  if (i < 0) return { titulo: texto, detalle: '' }
  return { titulo: texto.slice(0, i + 1), detalle: texto.slice(i + 2) }
}
