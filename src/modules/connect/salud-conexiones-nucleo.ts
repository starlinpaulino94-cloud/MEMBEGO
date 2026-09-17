/**
 * SALUD ACTIVA DE LAS CONEXIONES (auditoría B-3) — NÚCLEO PURO.
 *
 * Lo que decide si una conexión hay que reautorizarla ANTES de que un envío
 * falle, sin Prisma ni red, para poder probarlo caso por caso. La parte que lee
 * la base y escribe el aviso vive en `salud-conexiones.ts`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA REGLA, Y POR QUÉ NO VALE PARA TODAS LAS CREDENCIALES
 *
 * Una credencial se acerca a su fin no es, por sí solo, un problema: si el
 * proveedor deja refrescar el acceso desde el servidor —como Google con su
 * refresh token—, la caducidad del access token se renueva sola cada hora y
 * avisar de ella sería una falsa alarma diaria. El aviso solo tiene sentido para
 * las credenciales SIN refresco de servidor: Facebook Login (el acceso a datos
 * caduca a los 90 días y la única salida es volver a pasar por el diálogo) o una
 * API key con fecha. Esas son las «terminales», y son las únicas que se miran.
 *
 * El dato que se necesita —`expiresAt` y si hay refresco— vive en COLUMNAS NO
 * SECRETAS de la credencial, así que este chequeo no abre ningún sello ni llama
 * a ningún proveedor: es local y barato.
 */

import { MARGEN_REAUTORIZAR_MS } from '@/modules/connect/meta/tokensNucleo'

export { MARGEN_REAUTORIZAR_MS }

/** Lo que una credencial aporta a la decisión, sin abrir su sello. */
export interface CredencialSalud {
  /** Caducidad del secreto DEL PROVEEDOR. Null = no caduca o no se sabe. */
  expiresAt: Date | null
  /** ¿El proveedor deja refrescar el acceso desde el servidor? */
  tieneRefresh: boolean
}

/**
 * ¿Es una credencial cuya caducidad OBLIGA a reconectar?
 *
 * Solo si tiene fecha de caducidad Y no se puede refrescar: con refresco, la
 * fecha se renueva sola y no significa nada.
 */
export function esTerminal(c: CredencialSalud): boolean {
  return c.expiresAt !== null && !c.tieneRefresh
}

/**
 * ¿Esta credencial terminal se acerca a su fin (o ya lo pasó)?
 *
 * Se usa el mismo margen que Meta (`MARGEN_REAUTORIZAR_MS`, una semana): avisar
 * con siete días de antelación es lo que separa «reconecta cuando puedas» de «se
 * te cayó el servicio y no sabes por qué».
 */
export function credencialVencePronto(
  c: CredencialSalud,
  ahora: number,
  margen: number = MARGEN_REAUTORIZAR_MS
): boolean {
  return esTerminal(c) && c.expiresAt!.getTime() <= ahora + margen
}

/**
 * ¿La conexión necesita que alguien la reautorice?
 *
 * Sí cuando CUALQUIERA de sus credenciales terminales vence pronto: basta que se
 * caiga un secreto para que el servicio se pare, así que basta uno para avisar.
 */
export function conexionNecesitaReautorizar(
  credenciales: readonly CredencialSalud[],
  ahora: number,
  margen: number = MARGEN_REAUTORIZAR_MS
): boolean {
  return credenciales.some((c) => credencialVencePronto(c, ahora, margen))
}

/**
 * Qué hacer con el aviso de una conexión, comparando lo que ES con lo que ESTÁ
 * marcado. Devolver la acción —y no escribir aquí— es lo que mantiene puro el
 * núcleo y hace idempotente al cron: marcar lo ya marcado, o limpiar lo ya
 * limpio, no es nada.
 */
export type AccionSalud = 'marcar' | 'limpiar' | 'nada'

export function transicionSalud(necesita: boolean, yaMarcada: boolean): AccionSalud {
  if (necesita && !yaMarcada) return 'marcar'
  if (!necesita && yaMarcada) return 'limpiar'
  return 'nada'
}
