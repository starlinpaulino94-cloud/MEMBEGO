import { ROL_LABEL } from '@/types'

/**
 * FILTROS DEL CONTROL DE ACCESOS. Módulo PURO: se prueba sin base de datos.
 *
 * La pantalla traía TODOS los usuarios no-cliente como tarjetas, sin buscador,
 * sin filtro y sin paginar. Con cuatro se ve bien; con sesenta empleados
 * repartidos en diez empresas es una pared por la que hay que hacer scroll
 * leyendo nombres.
 *
 * Y había una pregunta que sencillamente no se podía hacer: **¿quiénes son
 * superadmin?**. En la pantalla que decide quién puede entrar a qué, esa es la
 * primera pregunta, no una comodidad.
 *
 * Los filtros viven en la URL, igual que en el CRM de empresas: se comparten
 * por enlace, el botón «atrás» deshace el último, y el servidor puede filtrar
 * de verdad en vez de mandar la lista entera para que el navegador la recorte.
 */

/** `todos` = sin filtro. El resto son valores de `AppRole`. */
export const ROLES_FILTRABLES = [
  'todos',
  'SUPERADMIN',
  'ADMINISTRADOR',
  'GERENTE',
  'CAJERO',
  'RECEPCION',
  'MARKETING',
  'SUPERVISOR',
  'EMPLEADO',
  'ADMIN_EMPRESA',
] as const
export type RolFiltro = (typeof ROLES_FILTRABLES)[number]

/**
 * Etiquetas del desplegable. Salen de `ROL_LABEL`, el mapa canónico: escribir
 * aquí «Gerente» otra vez sería la cuarta copia del mismo diccionario.
 */
export const ROL_FILTRO_LABEL: Record<RolFiltro, string> = Object.fromEntries(
  ROLES_FILTRABLES.map((r) => [r, r === 'todos' ? 'Todos los roles' : (ROL_LABEL[r] ?? r)])
) as Record<RolFiltro, string>

export const ORDENES = ['nombre', 'rol', 'reciente', 'antiguo'] as const
export type OrdenUsuario = (typeof ORDENES)[number]

export const ORDEN_LABEL: Record<OrdenUsuario, string> = {
  nombre: 'Nombre A-Z',
  rol: 'Rol',
  reciente: 'Alta más reciente',
  antiguo: 'Alta más antigua',
}

/**
 * CUÁNTO SILENCIO CONVIERTE UNA CUENTA EN SOSPECHOSA.
 *
 * Noventa días. No es un número redondo por casualidad: es un trimestre, el
 * tramo en el que un empleado que se fue ya se fue. Un administrador que no
 * deja rastro en tres meses o cambió de puesto, o dejó la empresa, y su acceso
 * sigue abierto.
 */
export const DIAS_INACTIVO = 90

export const POR_PAGINA = 24

export interface FiltroUsuarios {
  q: string
  rol: RolFiltro
  /** Id de empresa, o `null` = cualquiera. */
  empresa: string | null
  /** Solo cuentas sin rastro en los últimos `DIAS_INACTIVO` días. */
  inactivos: boolean
  orden: OrdenUsuario
  pagina: number
}

const enLista = <T extends string>(lista: readonly T[], v: string | undefined, pordefecto: T): T =>
  (lista as readonly string[]).includes(v ?? '') ? (v as T) : pordefecto

export function leerFiltroUsuarios(sp: Record<string, string | undefined>): FiltroUsuarios {
  const pagina = Number(sp.pagina)
  return {
    q: (sp.q ?? '').trim().slice(0, 80),
    rol: enLista(ROLES_FILTRABLES, sp.rol, 'todos'),
    // Cadena vacía y «todas» significan lo mismo —sin filtro— y las dos llegan:
    // una desde un `<select>` reseteado y otra desde un enlace escrito a mano.
    empresa: sp.empresa && sp.empresa !== 'todas' ? sp.empresa : null,
    inactivos: sp.inactivos === '1',
    orden: enLista(ORDENES, sp.orden, 'nombre'),
    pagina: Number.isFinite(pagina) && pagina > 0 ? Math.floor(pagina) : 1,
  }
}

/** ¿Hay algo puesto? Decide si se enseña el botón de limpiar. */
export function hayFiltro(f: FiltroUsuarios): boolean {
  return Boolean(f.q || f.rol !== 'todos' || f.empresa || f.inactivos)
}

/** Construye la URL con los filtros actuales más los cambios indicados. */
function href(f: FiltroUsuarios, base: string, cambios: Partial<FiltroUsuarios> = {}): string {
  const v = { ...f, ...cambios }
  const s = new URLSearchParams()
  if (v.q) s.set('q', v.q)
  if (v.rol !== 'todos') s.set('rol', v.rol)
  if (v.empresa) s.set('empresa', v.empresa)
  if (v.inactivos) s.set('inactivos', '1')
  if (v.orden !== 'nombre') s.set('orden', v.orden)
  if (v.pagina > 1) s.set('pagina', String(v.pagina))
  const qs = s.toString()
  return qs ? `${base}?${qs}` : base
}

/**
 * Las fichas de lo aplicado, cada una con la URL que la quita.
 *
 * Se calcula aquí y no en la vista para que quitar un filtro NO pierda los
 * demás: construir esos enlaces a mano en el JSX es exactamente donde se cuelan
 * los «al quitar el rol se me fue también la empresa».
 *
 * `empresas` llega solo para poder escribir el NOMBRE de la empresa en su
 * ficha. Enseñar el id sería enseñar algo que quien lee no reconoce.
 */
export function fichasDeFiltro(
  f: FiltroUsuarios,
  base: string,
  empresas: { id: string; name: string }[] = []
): { clave: string; texto: string; quitarHref: string }[] {
  const fichas: { clave: string; texto: string; quitarHref: string }[] = []
  const sin = (cambios: Partial<FiltroUsuarios>) => href(f, base, { ...cambios, pagina: 1 })

  if (f.q) fichas.push({ clave: 'q', texto: `«${f.q}»`, quitarHref: sin({ q: '' }) })
  if (f.rol !== 'todos')
    fichas.push({
      clave: 'rol',
      texto: ROL_FILTRO_LABEL[f.rol] ?? f.rol,
      quitarHref: sin({ rol: 'todos' }),
    })
  if (f.empresa)
    fichas.push({
      clave: 'empresa',
      texto: empresas.find((e) => e.id === f.empresa)?.name ?? 'Empresa',
      quitarHref: sin({ empresa: null }),
    })
  if (f.inactivos)
    fichas.push({
      clave: 'inactivos',
      texto: `Sin actividad en ${DIAS_INACTIVO} días`,
      quitarHref: sin({ inactivos: false }),
    })
  return fichas
}

/** Enlace a otra página conservando todo lo demás. */
export function hrefPagina(f: FiltroUsuarios, base: string, pagina: number): string {
  return href(f, base, { pagina })
}
