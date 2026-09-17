/**
 * ROTACIÓN DEL SECRETO DE SATÉLITE (auditoría A-7) — NÚCLEO PURO.
 *
 * Lo que decide QUÉ secretos están vivos y cómo verificar contra ellos, sin
 * Prisma ni red, para probarlo caso por caso. La parte que lee y escribe la base
 * vive en `rotacion-secreto.ts`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL SOLAPE ES ASIMÉTRICO, Y NO POR CASUALIDAD
 *
 * Lo SALIENTE (tokens SSO, webhooks) se firma siempre con el secreto PRIMARIO:
 * un satélite que aún no ha actualizado su .env sigue validando lo que le
 * mandamos, así que rotar no le corta nada. Lo ENTRANTE (la verificación de un
 * token SSO que el satélite nos presenta) se acepta contra CUALQUIERA de los
 * secretos vivos: así el satélite puede empezar a firmar con el nuevo en cuanto
 * lo instale, sin esperar a que los dos lados coincidan en el mismo minuto.
 *
 * Es lo contrario del modelo de los webhooks de empresa —que firman lo saliente
 * con una lista— y es a propósito: el token SSO es una firma única que no admite
 * lista, y el `X-Membego-Firma` de los satélites en producción se lee como un
 * solo valor. Meterle una lista rompería a quien ya funciona.
 */

import { DIAS_SOLAPE_ROTACION } from '@membego/contracts'

export { DIAS_SOLAPE_ROTACION }

/** Cuánto dura la ventana de solape, en milisegundos. */
export const SOLAPE_ROTACION_MS = DIAS_SOLAPE_ROTACION * 24 * 60 * 60 * 1000

/** Lo que la fila del sistema aporta a la decisión de qué secretos valen. */
export interface SecretosSistema {
  secreto: string
  secretoSiguiente: string | null
  secretoSiguienteHasta: Date | null
}

/**
 * Los secretos con los que se puede VERIFICAR algo entrante ahora mismo.
 *
 * El primario SIEMPRE; el siguiente SOLO mientras dure la ventana de solape. Un
 * `secretoSiguiente` con su fecha ya pasada NO se devuelve: aceptar para siempre
 * un secreto que se dio por caducado es lo contrario de rotar. El primario va el
 * primero para que el caso normal —sin rotación— pruebe una sola vez.
 */
export function secretosVivos(s: SecretosSistema, ahora: Date = new Date()): string[] {
  const enSolape =
    s.secretoSiguiente !== null &&
    s.secretoSiguienteHasta !== null &&
    s.secretoSiguienteHasta.getTime() > ahora.getTime()
  return enSolape ? [s.secreto, s.secretoSiguiente!] : [s.secreto]
}

/** ¿Hay una rotación en curso (dos secretos vivos) ahora mismo? */
export function rotacionEnCurso(s: SecretosSistema, ahora: Date = new Date()): boolean {
  return secretosVivos(s, ahora).length > 1
}

/**
 * Verifica algo probando cada secreto vivo, y devuelve el primer resultado
 * válido (no nulo). Es lo que convierte «acepta cualquiera de los dos» en una
 * línea, sin que cada punto de verificación reimplemente el bucle.
 *
 * `verificar` recibe un secreto y devuelve el dato si cuadra, o null si no. La
 * comparación de firmas de dentro es de tiempo constante, así que probar dos no
 * filtra cuál fue el bueno.
 */
export function verificarConVivos<T>(
  secretos: readonly string[],
  verificar: (secreto: string) => T | null
): T | null {
  for (const secreto of secretos) {
    const r = verificar(secreto)
    if (r !== null) return r
  }
  return null
}

/**
 * ¿Una rotación pendiente ya venció su ventana SIN haberse promovido?
 *
 * Cuando pasa, la pendiente se descarta —nunca se promueve sola—: mover el
 * secreto saliente a uno que el satélite quizá no instaló sería justo el corte
 * que la rotación existe para evitar. El defecto seguro es olvidarla y que el
 * operador vuelva a empezar.
 */
export function rotacionVencidaSinPromover(s: SecretosSistema, ahora: Date = new Date()): boolean {
  return (
    s.secretoSiguiente !== null &&
    s.secretoSiguienteHasta !== null &&
    s.secretoSiguienteHasta.getTime() <= ahora.getTime()
  )
}
