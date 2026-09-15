/**
 * EVENTOS DE MEMBRESÍA · las reglas puras.
 *
 * Sin Prisma ni `server-only`: lo que se puede decidir sin base de datos vive
 * aquí y se prueba con valores. La escritura está en `eventos.ts`, que sí es
 * de servidor. Es el mismo reparto que `vigencia.ts` / `vencimiento.ts`.
 */

export type TipoEventoMembresia =
  | 'CREADA'
  | 'ACTIVADA'
  | 'RENOVADA'
  | 'CAMBIO_PLAN'
  | 'CANCELADA'
  | 'VENCIDA'
  | 'RECHAZADA'

/**
 * El CAMINO por el que entró el evento, no el rol de quien lo hizo. Es lo que
 * distingue una renovación cobrada en el mostrador de una que cobró el cron
 * con la tarjeta guardada — dos hechos que el negocio lee muy distinto.
 */
export type OrigenEventoMembresia =
  | 'ADMIN'
  | 'CLIENTE'
  | 'SUPERADMIN'
  | 'CRON'
  | 'API'
  | 'RECONSTRUIDO'

export type ClaseCambioPlan = 'SUBIDA' | 'BAJADA' | 'LATERAL' | 'DESCONOCIDO'

/**
 * Subida, bajada o lateral — leyendo SOLO los importes guardados en el evento.
 *
 * Nunca los precios de hoy: un plan que subió de tarifa el mes pasado
 * convertiría retroactivamente en bajadas los cambios que fueron subidas.
 *
 * `DESCONOCIDO` cuando falta alguno de los dos. No es lo mismo que «lateral»:
 * lateral afirma que el cliente pagó lo mismo, y decir eso sin tener los dos
 * importes sería inventarse el hecho. Los reportes lo enseñan en su propia
 * fila en vez de repartirlo entre las otras tres.
 */
export function clasificarCambioPlan(
  precioAnterior: number | null | undefined,
  precioNuevo: number | null | undefined
): ClaseCambioPlan {
  if (precioAnterior == null || precioNuevo == null) return 'DESCONOCIDO'
  if (!Number.isFinite(precioAnterior) || !Number.isFinite(precioNuevo)) return 'DESCONOCIDO'
  if (precioNuevo > precioAnterior) return 'SUBIDA'
  if (precioNuevo < precioAnterior) return 'BAJADA'
  return 'LATERAL'
}

/**
 * Tasa de renovación: renovadas ÷ (renovadas + bajas), en porcentaje entero.
 *
 * `null` cuando no hubo ninguna de las dos. Una tasa sin base **no es 0 %**:
 * 0 % afirma que nadie renovó pudiendo hacerlo, y eso es una conclusión, no un
 * dato. Enseñarla porque la división no se puede hacer sería inventar una mala
 * noticia.
 */
export function tasaRenovacion(renovadas: number, bajas: number): number | null {
  const base = renovadas + bajas
  if (base <= 0) return null
  return Math.round((renovadas / base) * 100)
}
