import { createHash } from 'crypto'

/**
 * PLATAFORMA · Fase 3 — IDEMPOTENCIA, NÚCLEO PURO.
 *
 * Sin Prisma ni `server-only`: la decisión de qué hacer ante una clave repetida
 * se toma aquí, con datos planos, y por eso se puede probar al milímetro. El
 * envoltorio que reserva la clave en la base vive en `idempotencia.ts`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL PROBLEMA, EN UNA FRASE
 *
 * Un reintento de red sobre un canje consume el beneficio dos veces, y el
 * satélite NO puede distinguir «no llegó» de «llegó y se perdió la respuesta».
 * Desde su lado las dos cosas se ven igual: un timeout.
 *
 * Sin idempotencia solo hay dos opciones, y las dos son malas: reintentar —y a
 * veces regalar el beneficio dos veces— o no reintentar —y a veces perder la
 * operación—. La clave convierte esa ambigüedad en una respuesta repetible.
 */

/** 24 horas. Un reintento razonable ocurre en minutos; un día es margen de sobra. */
export const VIGENCIA_MS = 24 * 60 * 60 * 1000

/** Mientras la primera petición no termina, su fila existe sin respuesta aún. */
export const EN_CURSO = 0

export function huellaDe(cuerpo: string): string {
  return createHash('sha256').update(cuerpo, 'utf8').digest('hex')
}

export interface ClavePrevia {
  endpoint: string
  huellaPeticion: string
  estadoHttp: number
}

/**
 * Qué hacer con una clave que ya existía.
 *
 *   REPETIDA  — mismo endpoint y mismo cuerpo: devolver lo guardado.
 *   REUSADA   — misma clave, otra cosa: es un error del cliente.
 *   EN_CURSO  — la primera todavía trabaja.
 *
 * REUSADA es la que importa. Casi siempre viene de una clave derivada de algo
 * que no identifica la operación (la fecha, el id de mesa). Aceptarla en
 * silencio devolvería la respuesta de OTRA operación como si fuera la de esta
 * — un fallo que se lee como un acierto, y el peor sitio posible para tener uno.
 */
export type VeredictoClave = 'REPETIDA' | 'REUSADA' | 'EN_CURSO'

export function decidirClave(
  previa: ClavePrevia,
  endpoint: string,
  huella: string
): VeredictoClave {
  // El endpoint entra en la comparación: la misma clave en dos rutas distintas
  // son dos operaciones distintas, no un reintento de ninguna.
  if (previa.endpoint !== endpoint || previa.huellaPeticion !== huella) return 'REUSADA'
  return previa.estadoHttp === EN_CURSO ? 'EN_CURSO' : 'REPETIDA'
}
