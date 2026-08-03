/**
 * PAGINACIÓN DEL LADO DEL SERVIDOR — núcleo puro.
 *
 * Por qué existe: varias tablas del panel traían un tope fijo (300 filas) y
 * mostraban "truncado" cuando había más. El dato existía pero era INALCANZABLE:
 * no se podía llegar al registro 301 por ningún camino. Esto convierte ese tope
 * en páginas navegables.
 *
 * Sin React ni Prisma: se puede probar y reutilizar desde cualquier capa.
 */

/** Tamaños de página ofrecidos al usuario. El primero es el de por defecto. */
export const TAMANOS_PAGINA = [25, 50, 100, 200] as const

export const TAMANO_POR_DEFECTO = TAMANOS_PAGINA[0]

/** Tope duro: ni con manipulación de la URL se piden más filas que esto. */
export const TAMANO_MAXIMO = 200

export interface Paginacion {
  /** Página actual, base 1. */
  pagina: number
  /** Filas por página, ya acotado a un valor permitido. */
  tamano: number
  /** Filas a saltar (para `skip` de Prisma). */
  saltar: number
  /** Filas a traer (para `take` de Prisma). */
  tomar: number
}

function aEntero(valor: unknown): number | null {
  if (typeof valor === 'number' && Number.isFinite(valor)) return Math.trunc(valor)
  if (typeof valor !== 'string' || !valor.trim()) return null
  const n = Number(valor)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

/**
 * Lee `page` y `pageSize` de los parámetros de la URL y los normaliza.
 *
 * Tolerante a basura por diseño: una URL manipulada a mano (`?page=-5`,
 * `?pageSize=999999`) no debe romper la página ni permitir descargar la tabla
 * completa — se acota a un rango seguro.
 */
export function leerPaginacion(
  params: Record<string, string | string[] | undefined>,
  tamanoPorDefecto: number = TAMANO_POR_DEFECTO
): Paginacion {
  const crudoPagina = Array.isArray(params.page) ? params.page[0] : params.page
  const crudoTamano = Array.isArray(params.pageSize) ? params.pageSize[0] : params.pageSize

  const pagina = Math.max(1, aEntero(crudoPagina) ?? 1)
  const pedido = aEntero(crudoTamano) ?? tamanoPorDefecto
  const tamano = Math.min(TAMANO_MAXIMO, Math.max(1, pedido))

  return { pagina, tamano, saltar: (pagina - 1) * tamano, tomar: tamano }
}

export interface ResumenPaginas {
  pagina: number
  tamano: number
  total: number
  totalPaginas: number
  /** Índice humano de la primera fila mostrada (1-based); 0 si no hay filas. */
  desde: number
  /** Índice humano de la última fila mostrada. */
  hasta: number
  hayAnterior: boolean
  haySiguiente: boolean
}

/**
 * Calcula el estado visible de la paginación a partir del total real.
 *
 * Corrige la página fuera de rango: si el usuario está en la página 9 y un
 * filtro deja solo 2 páginas, se muestra la última con datos en vez de una
 * pantalla vacía sin explicación.
 */
export function resumirPaginas(
  paginacion: Pick<Paginacion, 'pagina' | 'tamano'>,
  total: number
): ResumenPaginas {
  const totalSeguro = Math.max(0, Math.trunc(total))
  const totalPaginas = Math.max(1, Math.ceil(totalSeguro / paginacion.tamano))
  const pagina = Math.min(Math.max(1, paginacion.pagina), totalPaginas)
  const desde = totalSeguro === 0 ? 0 : (pagina - 1) * paginacion.tamano + 1
  const hasta = Math.min(pagina * paginacion.tamano, totalSeguro)

  return {
    pagina,
    tamano: paginacion.tamano,
    total: totalSeguro,
    totalPaginas,
    desde,
    hasta,
    hayAnterior: pagina > 1,
    haySiguiente: pagina < totalPaginas,
  }
}

/**
 * Construye el query string de un salto de página CONSERVANDO los filtros
 * activos (búsqueda, tipo, estado, fechas…). Que los filtros sobrevivan al
 * cambio de página es justo lo que hace usable una tabla filtrada.
 *
 * `page=1` se omite: la primera página es la URL limpia y compartible.
 */
export function urlDePagina(
  paramsActuales: Record<string, string | string[] | undefined>,
  cambios: { page?: number; pageSize?: number }
): string {
  const sp = new URLSearchParams()
  for (const [clave, valor] of Object.entries(paramsActuales)) {
    if (clave === 'page' || clave === 'pageSize') continue
    const v = Array.isArray(valor) ? valor[0] : valor
    if (v) sp.set(clave, v)
  }
  if (cambios.pageSize && cambios.pageSize !== TAMANO_POR_DEFECTO) {
    sp.set('pageSize', String(cambios.pageSize))
  }
  if (cambios.page && cambios.page > 1) sp.set('page', String(cambios.page))

  const q = sp.toString()
  return q ? `?${q}` : ''
}
