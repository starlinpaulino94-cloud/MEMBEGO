/**
 * VOCABULARIO DE FILTROS del panel — puro, compartido, y en la URL.
 *
 * Tres reglas que explican por qué esto existe como módulo y no como código
 * suelto en cada pantalla:
 *
 * 1. **Un filtro es una pregunta de negocio, no una consulta.** «Sin visitas en
 *    30 días» significa lo mismo en Clientes, en Membresías, en el reporte de
 *    riesgo y en el CSV. Si cada pantalla lo tradujera por su cuenta, la
 *    primera divergencia aparecería el día que alguien cambie una y no las
 *    otras — que es exactamente el patrón que encontró la auditoría.
 *
 * 2. **Todo filtro viaja en la URL.** Una lista filtrada se comparte por
 *    WhatsApp, se guarda en marcadores y se enlaza desde el Resumen. Un filtro
 *    que solo vive en el estado del navegador no se puede señalar con el dedo.
 *
 * 3. **Un valor inventado se ignora, no rompe.** Las URLs se editan a mano y
 *    llegan recortadas por los mensajeros. Ante basura, el filtro no se aplica
 *    y la pantalla enseña todo: nunca menos datos de los que corresponden sin
 *    que se vea por qué.
 */

/** Ventanas de «hace cuánto que no viene». La primera es la de por defecto. */
export const DIAS_SIN_VISITAS = [15, 30, 60, 90] as const

/** Ventanas de «cuándo se le vence». */
export const DIAS_PARA_VENCER = [7, 15, 30] as const

/** Lee un número de una lista cerrada. Fuera de la lista → sin filtro. */
export function leerVentana<T extends number>(
  valor: string | undefined,
  permitidos: readonly T[]
): T | undefined {
  const n = Number(valor)
  return permitidos.includes(n as T) ? (n as T) : undefined
}

/** Instante de hace N días. */
export function haceDias(dias: number, ahora: Date = new Date()): Date {
  return new Date(ahora.getTime() - dias * 86_400_000)
}

/** Instante dentro de N días. */
export function dentroDeDias(dias: number, ahora: Date = new Date()): Date {
  return new Date(ahora.getTime() + dias * 86_400_000)
}

/** Días enteros entre hoy y una fecha futura (negativo si ya pasó). */
export function diasHasta(fecha: Date | null, ahora: Date = new Date()): number | null {
  if (!fecha) return null
  return Math.ceil((fecha.getTime() - ahora.getTime()) / 86_400_000)
}

/** Días enteros desde una fecha pasada. `null` = nunca ocurrió. */
export function diasDesde(fecha: Date | null, ahora: Date = new Date()): number | null {
  if (!fecha) return null
  return Math.floor((ahora.getTime() - fecha.getTime()) / 86_400_000)
}

/**
 * Construye una URL conservando los filtros actuales y cambiando solo los que
 * se indican. `undefined` borra el filtro; el resto sobrevive.
 *
 * Es la mecánica que hace que los filtros se puedan combinar sin que pulsar uno
 * borre el anterior — el defecto más común de los filtros por enlaces.
 */
export function urlConFiltros(
  base: string,
  actuales: Record<string, string | string[] | undefined>,
  cambios: Record<string, string | number | undefined>
): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(actuales)) {
    // La página vuelve a la 1 al cambiar un filtro: seguir en la 7 de una lista
    // que ahora tiene 2 páginas es una pantalla vacía sin explicación.
    if (k === 'page') continue
    const valor = Array.isArray(v) ? v[0] : v
    if (valor) sp.set(k, valor)
  }
  for (const [k, v] of Object.entries(cambios)) {
    if (v === undefined || v === '' ) sp.delete(k)
    else sp.set(k, String(v))
  }
  const q = sp.toString()
  return q ? `${base}?${q}` : base
}
