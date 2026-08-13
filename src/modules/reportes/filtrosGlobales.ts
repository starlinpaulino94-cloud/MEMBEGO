/**
 * Reportes de plataforma · FILTROS — núcleo puro.
 *
 * Sin Prisma ni React: lo que decide qué entra en el reporte del superadmin se
 * puede probar sin base de datos.
 */

export const ORDENES = [
  { clave: 'ingresos', label: 'Ingresos' },
  { clave: 'activas', label: 'Membresías activas' },
  { clave: 'usos', label: 'Usos' },
  { clave: 'nombre', label: 'Nombre' },
] as const

export type OrdenEmpresas = (typeof ORDENES)[number]['clave']
export const ORDEN_POR_DEFECTO: OrdenEmpresas = 'ingresos'

export interface FiltroGlobal {
  /** Texto libre contra el nombre de la empresa. */
  q: string
  /**
   * ¿Se cuentan las empresas de práctica?
   *
   * Por defecto NO, y esa es la corrección: el reporte las metía dentro de los
   * totales de la plataforma mientras el Resumen —la pantalla de al lado— las
   * dejaba fuera. Dos cifras distintas del mismo periodo, y la que parecía más
   * autorizada era la que estaba mal.
   *
   * El interruptor existe porque durante un entrenamiento sí hace falta ver
   * que los números se mueven; lo que no puede pasar es que se mezclen sin
   * decirlo.
   */
  incluirDemo: boolean
  orden: OrdenEmpresas
}

function texto(v: string | string[] | undefined): string {
  const s = Array.isArray(v) ? v[0] : v
  return typeof s === 'string' ? s.trim() : ''
}

export function leerFiltroGlobal(
  params: Record<string, string | string[] | undefined>
): FiltroGlobal {
  const ordenPedido = texto(params.orden)
  return {
    q: texto(params.q).slice(0, 80),
    incluirDemo: texto(params.demo) === '1',
    orden: ORDENES.some((o) => o.clave === ordenPedido)
      ? (ordenPedido as OrdenEmpresas)
      : ORDEN_POR_DEFECTO,
  }
}

/** Query string del filtro, para enlaces, exportación y paginación. */
export function paramsDeFiltroGlobal(f: FiltroGlobal): URLSearchParams {
  const sp = new URLSearchParams()
  if (f.q) sp.set('q', f.q)
  if (f.incluirDemo) sp.set('demo', '1')
  if (f.orden !== ORDEN_POR_DEFECTO) sp.set('orden', f.orden)
  return sp
}

export interface FilaEmpresa {
  companyId: string
  nombre: string
  moneda: string
  esDemo: boolean
  ingresos: number
  activas: number
  usos: number
  porVencer: number
}

/**
 * Ordena y filtra en memoria.
 *
 * En memoria y no en la base a propósito: las filas ya están todas cargadas
 * —son una por empresa, decenas, no miles— y los criterios de orden son
 * agregados que se calculan aquí. Hacerlo en SQL exigiría una vista o cinco
 * consultas más para ganar nada.
 */
export function ordenarEmpresas(filas: FilaEmpresa[], f: FiltroGlobal): FilaEmpresa[] {
  const q = f.q.toLowerCase()
  const visibles = filas.filter(
    (e) => (f.incluirDemo || !e.esDemo) && (!q || e.nombre.toLowerCase().includes(q))
  )
  const porNombre = (a: FilaEmpresa, b: FilaEmpresa) => a.nombre.localeCompare(b.nombre, 'es')
  return visibles.sort((a, b) => {
    switch (f.orden) {
      case 'activas':
        return b.activas - a.activas || porNombre(a, b)
      case 'usos':
        return b.usos - a.usos || porNombre(a, b)
      case 'nombre':
        return porNombre(a, b)
      default:
        return b.ingresos - a.ingresos || porNombre(a, b)
    }
  })
}

/**
 * Ingresos agrupados POR MONEDA, no en una sola cifra.
 *
 * Si mañana una empresa cobra en dólares, sumar sus pesos con los de las demás
 * da un número que no es dinero de nada. Devolver una entrada por moneda es lo
 * único que no miente, y mientras todas cobren en DOP —que es hoy— se ve
 * exactamente igual que antes: una sola línea.
 */
export function totalPorMoneda(filas: FilaEmpresa[]): { moneda: string; total: number }[] {
  const acc = new Map<string, number>()
  for (const f of filas) acc.set(f.moneda, (acc.get(f.moneda) ?? 0) + f.ingresos)
  return [...acc.entries()]
    .map(([moneda, total]) => ({ moneda, total }))
    .sort((a, b) => b.total - a.total)
}

/**
 * ¿Hace falta avisar de que hay más de una moneda?
 *
 * Solo cuando de verdad hay dos o más CON dinero. Una empresa en USD que
 * todavía no ha cobrado nada no convierte el reporte en multimoneda.
 */
export function hayVariasMonedas(filas: FilaEmpresa[]): boolean {
  return totalPorMoneda(filas).filter((m) => m.total > 0).length > 1
}
