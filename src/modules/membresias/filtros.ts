import { membresiaEstadoUi } from '@/lib/estados'

/**
 * FILTROS DEL PUESTO DE MANDO DE MEMBRESÍAS. Módulo PURO: se prueba sin base.
 *
 * La pantalla ya filtraba en servidor, así que aquí lo que se arregla es OTRA
 * cosa: qué se acepta como filtro.
 *
 *  · `estado` iba de la URL al `where` de Prisma con un `as MembershipEstado` y
 *    nada más. Un `?estado=FOO` reventaba en la base, se lo tragaba el `catch`
 *    y la pantalla salía vacía sin decir por qué. Un `as` no valida nada: solo
 *    silencia al compilador.
 *
 *  · No había forma de separar las membresías de PRÁCTICA de las reales. En una
 *    pantalla que cruza todas las empresas, los datos de un entrenamiento
 *    parecen ventas.
 */

/** Los estados reales de una membresía. `todos` = sin filtro. */
export const ESTADOS_MEMBRESIA = [
  'PENDIENTE',
  'PENDIENTE_PAGO',
  'RECHAZADA',
  'ACTIVA',
  'VENCIDA',
  'CANCELADA',
] as const
export type EstadoMembresia = (typeof ESTADOS_MEMBRESIA)[number]

/**
 * «Vigente» NO es un estado de la base: es ACTIVA *y* sin vencer.
 *
 * Se ofrece como filtro porque es la pregunta que de verdad se hace —cuántas
 * valen HOY— y porque `ACTIVA` a secas incluye las que el mostrador ya rechaza.
 * `vencidas-sin-marcar` es su complemento: las que siguen diciendo ACTIVA en la
 * base pero cuya fecha pasó. Si esa lista no está vacía, el job diario no corrió.
 */
export const VISTAS_EXTRA = ['vigentes', 'vencidas-sin-marcar'] as const
export type VistaExtra = (typeof VISTAS_EXTRA)[number]

export const FILTROS_ESTADO = ['todos', ...VISTAS_EXTRA, ...ESTADOS_MEMBRESIA] as const
export type FiltroEstado = (typeof FILTROS_ESTADO)[number]

export const ESTADO_LABEL: Record<FiltroEstado, string> = Object.fromEntries(
  FILTROS_ESTADO.map((e) => [
    e,
    e === 'todos'
      ? 'Todos los estados'
      : e === 'vigentes'
        ? 'Vigentes hoy'
        : e === 'vencidas-sin-marcar'
          ? 'Vencidas sin marcar'
          : membresiaEstadoUi(e).label,
  ])
) as Record<FiltroEstado, string>

/** Igual que en Empresas: las de práctica no se cuelan ni se esconden del todo. */
export const AMBITOS = ['reales', 'practica', 'todas'] as const
export type AmbitoMembresia = (typeof AMBITOS)[number]

export const AMBITO_LABEL: Record<AmbitoMembresia, string> = {
  reales: 'Empresas reales',
  practica: 'Solo de práctica',
  todas: 'Reales y de práctica',
}

export interface FiltroMembresias {
  q: string
  estado: FiltroEstado
  /** Id de empresa, o `null` = todas. */
  empresa: string | null
  ambito: AmbitoMembresia
}

const enLista = <T extends string>(lista: readonly T[], v: string | undefined, pordefecto: T): T =>
  (lista as readonly string[]).includes(v ?? '') ? (v as T) : pordefecto

export function leerFiltroMembresias(sp: Record<string, string | undefined>): FiltroMembresias {
  return {
    q: (sp.q ?? '').trim().slice(0, 80),
    // Aquí está la validación que faltaba: lo que no sea un valor conocido
    // degrada a «todos» en vez de llegar al `where`.
    estado: enLista(FILTROS_ESTADO, sp.estado, 'todos'),
    empresa: sp.empresa && sp.empresa !== 'todas' ? sp.empresa : null,
    ambito: enLista(AMBITOS, sp.ambito, 'reales'),
  }
}

/** ¿Hay algo puesto? Decide si se enseña el botón de limpiar. */
export function hayFiltro(f: FiltroMembresias): boolean {
  return Boolean(f.q || f.estado !== 'todos' || f.empresa || f.ambito !== 'reales')
}

/**
 * URL con estos filtros. `extra` permite añadir o quitar parámetros ajenos
 * —la paginación, sin ir más lejos— sin que este módulo los conozca.
 */
export function hrefFiltro(
  f: Partial<FiltroMembresias>,
  base: string,
  extra: Record<string, string | undefined> = {}
): string {
  const s = new URLSearchParams()
  if (f.q) s.set('q', f.q)
  if (f.estado && f.estado !== 'todos') s.set('estado', f.estado)
  if (f.empresa) s.set('empresa', f.empresa)
  if (f.ambito && f.ambito !== 'reales') s.set('ambito', f.ambito)
  for (const [k, v] of Object.entries(extra)) if (v) s.set(k, v)
  const qs = s.toString()
  return qs ? `${base}?${qs}` : base
}

/**
 * Las fichas de lo aplicado, cada una con la URL que la quita.
 *
 * Se calculan aquí y no en el JSX para que quitar un filtro no se lleve los
 * demás por delante — que es exactamente donde se cuelan esos errores.
 */
export function fichasDeFiltro(
  f: FiltroMembresias,
  base: string,
  empresas: { id: string; name: string }[] = []
): { clave: string; texto: string; quitarHref: string }[] {
  const fichas: { clave: string; texto: string; quitarHref: string }[] = []
  const sin = (cambios: Partial<FiltroMembresias>) => hrefFiltro({ ...f, ...cambios }, base)

  if (f.q) fichas.push({ clave: 'q', texto: `«${f.q}»`, quitarHref: sin({ q: '' }) })
  if (f.estado !== 'todos')
    fichas.push({ clave: 'estado', texto: ESTADO_LABEL[f.estado], quitarHref: sin({ estado: 'todos' }) })
  if (f.empresa)
    fichas.push({
      clave: 'empresa',
      texto: empresas.find((e) => e.id === f.empresa)?.name ?? 'Empresa',
      quitarHref: sin({ empresa: null }),
    })
  if (f.ambito !== 'reales')
    fichas.push({ clave: 'ambito', texto: AMBITO_LABEL[f.ambito], quitarHref: sin({ ambito: 'reales' }) })
  return fichas
}
