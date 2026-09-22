import { TZ_PLATAFORMA } from '@/lib/format'

/**
 * ¿ES ESTO UNA ZONA HORARIA DE VERDAD?
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ HACE FALTA PREGUNTARLO
 *
 * `companies.zonaHoraria` se escribe desde una caja de TEXTO LIBRE del perfil
 * de la empresa. «America/Santo_Domingo» es solo el marcador de posición: lo
 * que se guarda es lo que alguien teclee. Y `Intl.DateTimeFormat` no devuelve
 * un error ante un valor que no reconoce —«GMT-4», «Santo Domingo», «AST»,
 * «America/Nueva_York»—: **lanza** `RangeError: Invalid time zone specified`.
 *
 * Un `RangeError` dentro del render de un Server Component no se ve como un
 * dato mal escrito. Se ve como «No se pudo cargar esta sección» y un número de
 * error, en TODAS las pantallas de ese módulo y para siempre, porque el valor
 * malo sigue en la fila.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ESTO NO ES UN MECANISMO NUEVO
 *
 * `src/lib/format.ts` ya degradaba a la zona de plataforma cuando la de la
 * empresa no valía, y `src/lib/periodos.ts` tenía su propia copia privada de
 * esta misma función. Por eso el fallo se veía en Reportes y en ningún otro
 * sitio: los demás módulos formatean por `format.ts`, que sobrevive, y
 * Reportes es el único que mete la zona cruda en `Intl` —y en un `AT TIME
 * ZONE` de SQL— por su cuenta.
 *
 * Aquí la regla queda UNA vez, y las dos copias pasan a llamarla.
 */

/**
 * Resultados memorizados. `diaLocal` se llama una vez por fila al agrupar por
 * día, y construir un `Intl.DateTimeFormat` para descartarlo no es gratis.
 *
 * Se vacía al pasar de mil entradas. La zona sale de una fila de empresa —un
 * conjunto pequeño y estable— pero esta función es pública y nada impide que
 * mañana alguien le pase algo que venga de la URL: un mapa que solo crece es
 * una fuga de memoria esperando a ese día.
 */
const CONOCIDAS = new Map<string, boolean>()
const TOPE_CACHE = 1000

export function esZonaValida(zona: unknown): zona is string {
  if (typeof zona !== 'string' || zona.trim() === '') return false

  const recordada = CONOCIDAS.get(zona)
  if (recordada !== undefined) return recordada

  let vale: boolean
  try {
    // Construir basta: el `RangeError` sale del constructor, no del formateo.
    new Intl.DateTimeFormat('en-US', { timeZone: zona })
    vale = true
  } catch {
    vale = false
  }

  if (CONOCIDAS.size >= TOPE_CACHE) CONOCIDAS.clear()
  CONOCIDAS.set(zona, vale)
  return vale
}

/**
 * La zona de la empresa, o la de la plataforma si la suya no sirve.
 *
 * DEGRADAR Y NO FALLAR, igual que `formatDate`. Enseñar el reporte con el
 * corte del día en la zona de plataforma es un error de horas en el borde del
 * periodo; no enseñar nada es un módulo caído. Y quien pueda arreglarlo de
 * verdad —cambiar el valor en el perfil— necesita poder entrar a mirarlo.
 */
export function zonaSegura(
  zona: string | null | undefined,
  respaldo: string = TZ_PLATAFORMA
): string {
  if (esZonaValida(zona)) return zona
  return esZonaValida(respaldo) ? respaldo : TZ_PLATAFORMA
}
