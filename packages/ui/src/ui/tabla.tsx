import type { ReactNode } from 'react'
import { cn } from '../cn'
import { EmptyState } from './empty-state'
import { EstadoChip, type TonoEstado } from './estado-chip'

/**
 * Los tipos de celda (docs/auditoria-admin/06 §4, regla 14). Un tipo decide alineación, formato y marcado:
 * dinero y número a la derecha con cifras tabulares; fecha en `<time>`; estado con `EstadoChip`; enlace como el destino
 * de la fila.
 */
export type TipoCelda = 'texto' | 'numero' | 'dinero' | 'fecha' | 'fechaHora' | 'estado' | 'enlace'

export interface ValorEstado {
  etiqueta: string
  tono: TonoEstado
}

export interface ValorEnlace {
  texto: ReactNode
  href: string
}

/**
 * Cómo formatear, resuelto UNA vez por página con las preferencias regionales de la empresa y pasado a la tabla. La
 * primitiva no importa nada de la aplicación (moneda, idioma y zona horaria son de cada empresa: 06 · T-18).
 */
export interface FormatoTabla {
  numero?: (valor: number) => string
  dinero?: (valor: number | string) => string
  fecha?: (valor: Date | string) => string
  fechaHora?: (valor: Date | string) => string
}

export interface Columna<F> {
  clave: string
  encabezado: string
  /** Por defecto `texto`. */
  tipo?: TipoCelda
  /** Valor de la celda. Por defecto, `fila[clave]`. */
  valor?: (fila: F) => unknown
  /** Contenido propio (acciones, composiciones). Prevalece sobre `tipo`. */
  celda?: (fila: F) => ReactNode
  /**
   * 1: siempre visible. 2: se oculta bajo 768 px. 3: se oculta bajo 1024 px. Máximo seis columnas visibles en escritorio
   * (06 §4, regla 4); lo demás va al detalle.
   */
  prioridad?: 1 | 2 | 3
  /** Cabecera con enlace de orden y `aria-sort`. Requiere `hrefOrden` en la tabla. */
  ordenable?: boolean
  /** El encabezado solo para lectores de pantalla: la columna de acciones. */
  soloLector?: boolean
  alineacion?: 'izquierda' | 'derecha'
}

export interface OrdenTabla {
  clave: string
  dir: 'asc' | 'desc'
}

/** Cómo pintar un enlace de la tabla. El design system no depende del router: la página pasa su `<Link>`. */
export type EnlaceTabla = (props: { href: string; className: string; children: ReactNode }) => ReactNode

const enlaceNativo: EnlaceTabla = ({ href, className, children }) => (
  <a href={href} className={className}>
    {children}
  </a>
)

export interface TextoVacio {
  titulo: string
  descripcion?: string
  accion?: ReactNode
}

interface TablaProps<F> {
  /** Nombre de la tabla para lectores de pantalla (`<caption class="sr-only">`). Obligatorio (06 · T-15). */
  caption: string
  columnas: readonly Columna<F>[]
  filas: readonly F[]
  claveDe: (fila: F) => string
  formato?: FormatoTabla
  /** Orden actual, leído de la URL por la página. */
  orden?: OrdenTabla
  /** URL de la misma pantalla con otro orden. Lista blanca de columnas ordenables: la decide la página. */
  hrefOrden?: (clave: string, dir: 'asc' | 'desc') => string
  enlace?: EnlaceTabla
  /** La columna identificadora (por defecto la primera) es el `<th scope="row">` de cada fila. */
  columnaIdentificadora?: string
  /** Resalta la fila al pasar el puntero: solo si la fila es navegable. */
  filaNavegable?: boolean
  /** Vacío REAL: todavía no hay nada. Con la acción para crear lo primero. */
  vacio?: TextoVacio
  /** Vacío por FILTRO: hay cosas, pero ninguna coincide. Con «Limpiar filtros». */
  sinResultados?: TextoVacio
  hayFiltros?: boolean
  /** Pie: paginación, total, exportar. */
  pie?: ReactNode
  className?: string
}

const OCULTAR_POR_PRIORIDAD = { 1: '', 2: 'max-md:hidden', 3: 'max-lg:hidden' } as const

const VACIO_POR_DEFECTO: TextoVacio = { titulo: 'Todavía no hay nada aquí' }
const SIN_RESULTADOS_POR_DEFECTO: TextoVacio = {
  titulo: 'Ningún resultado coincide',
  descripcion: 'Prueba con otro nombre o quita un filtro.',
}

const aIso = (v: Date | string): string | null => {
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function Celda<F>({
  columna,
  fila,
  formato,
  enlace,
}: {
  columna: Columna<F>
  fila: F
  formato: FormatoTabla
  enlace: EnlaceTabla
}): ReactNode {
  if (columna.celda) return columna.celda(fila)
  const valor = columna.valor ? columna.valor(fila) : (fila as Record<string, unknown>)[columna.clave]
  if (valor === null || valor === undefined || valor === '') {
    return (
      <>
        <span aria-hidden>—</span>
        <span className="sr-only">Sin dato</span>
      </>
    )
  }
  switch (columna.tipo ?? 'texto') {
    case 'numero':
      return formato.numero ? formato.numero(Number(valor)) : Number(valor).toLocaleString('es-DO')
    case 'dinero':
      return formato.dinero ? formato.dinero(valor as number | string) : String(valor)
    case 'fecha':
    case 'fechaHora': {
      const v = valor as Date | string
      const f = columna.tipo === 'fecha' ? formato.fecha : formato.fechaHora
      const texto = f ? f(v) : String(v instanceof Date ? v.toISOString() : v)
      const iso = aIso(v)
      return iso ? <time dateTime={iso}>{texto}</time> : texto
    }
    case 'estado': {
      const e = valor as ValorEstado
      return <EstadoChip tono={e.tono}>{e.etiqueta}</EstadoChip>
    }
    case 'enlace': {
      const e = valor as ValorEnlace
      return enlace({ href: e.href, className: 'font-medium text-primary hover:underline', children: e.texto })
    }
    default:
      return String(valor)
  }
}

/**
 * La tabla del panel (06 §4). De SERVIDOR: sin estado; filtros, orden y paginación viajan en la URL.
 *
 *   <Tabla caption="Clientes" columnas={...} filas={...} claveDe={(c) => c.id}
 *          formato={{ dinero, fecha }} orden={orden} hrefOrden={hrefOrden} pie={<TablaPaginacion … />} />
 *
 * Lo que impone, para que no dependa de que alguien se acuerde:
 *   · `<caption>` y `<th scope>` siempre; el orden con `aria-sort` y la cabecera como enlace.
 *   · Dinero y números a la derecha con cifras tabulares; fechas en `<time dateTime>`.
 *   · Lo que no hay se dice («Sin dato»), no se deja en blanco.
 *   · Vacío en dos variantes (no hay nada / nada coincide) con `EmptyState`.
 *   · En móvil, scroll horizontal DENTRO de la tabla, con la columna identificadora fija a la izquierda; nunca de la página.
 *
 * Pendiente (fase 5, tarea 5.2): variante de tarjetas para las colas de trabajo con botones (Pagos).
 */
export function Tabla<F>({
  caption,
  columnas,
  filas,
  claveDe,
  formato = {},
  orden,
  hrefOrden,
  enlace = enlaceNativo,
  columnaIdentificadora,
  filaNavegable = false,
  vacio = VACIO_POR_DEFECTO,
  sinResultados = SIN_RESULTADOS_POR_DEFECTO,
  hayFiltros = false,
  pie,
  className,
}: TablaProps<F>) {
  const idCol = columnaIdentificadora ?? columnas[0]?.clave
  const textoVacio = hayFiltros ? sinResultados : vacio

  return (
    <div data-slot="tabla" className={cn('overflow-hidden rounded-xl border border-border bg-card shadow-sm', className)}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-small">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-border bg-muted/60">
              {columnas.map((c) => {
                const derecha = c.alineacion ? c.alineacion === 'derecha' : c.tipo === 'numero' || c.tipo === 'dinero'
                const activa = orden?.clave === c.clave
                const sigue = activa && orden.dir === 'asc' ? 'desc' : 'asc'
                return (
                  <th
                    key={c.clave}
                    scope="col"
                    aria-sort={activa ? (orden.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                    className={cn(
                      'whitespace-nowrap px-3 py-3 text-overline text-muted-foreground md:px-4',
                      derecha ? 'text-right' : 'text-left',
                      OCULTAR_POR_PRIORIDAD[c.prioridad ?? 1],
                      c.clave === idCol && 'min-w-32 md:min-w-40 max-md:sticky max-md:left-0 max-md:bg-muted'
                    )}
                  >
                    {c.soloLector ? (
                      <span className="sr-only">{c.encabezado}</span>
                    ) : c.ordenable && hrefOrden ? (
                      enlace({
                        href: hrefOrden(c.clave, sigue),
                        className: 'inline-flex items-center gap-1 hover:text-foreground',
                        children: (
                          <>
                            {c.encabezado}
                            <span aria-hidden>{activa ? (orden.dir === 'asc' ? '↑' : '↓') : ''}</span>
                          </>
                        ),
                      })
                    ) : (
                      c.encabezado
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {filas.length === 0 ? (
              <tr>
                <td colSpan={columnas.length}>
                  <EmptyState title={textoVacio.titulo} description={textoVacio.descripcion} action={textoVacio.accion} />
                </td>
              </tr>
            ) : (
              filas.map((fila) => (
                <tr
                  key={claveDe(fila)}
                  className={cn('border-b border-border last:border-0', filaNavegable && 'hover:bg-muted/50')}
                >
                  {columnas.map((c) => {
                    const derecha = c.alineacion ? c.alineacion === 'derecha' : c.tipo === 'numero' || c.tipo === 'dinero'
                    const clases = cn(
                      'px-3 py-3 align-middle md:px-4',
                      derecha ? 'text-right tabular-nums' : 'text-left',
                      OCULTAR_POR_PRIORIDAD[c.prioridad ?? 1]
                    )
                    const contenido = <Celda columna={c} fila={fila} formato={formato} enlace={enlace} />
                    return c.clave === idCol ? (
                      <th
                        key={c.clave}
                        scope="row"
                        className={cn(clases, 'min-w-32 font-medium text-foreground md:min-w-40 max-md:sticky max-md:left-0 max-md:bg-card')}
                      >
                        {contenido}
                      </th>
                    ) : (
                      <td key={c.clave} className={clases}>
                        {contenido}
                      </td>
                    )
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {pie && <div className="border-t border-border px-4 py-3 text-small text-muted-foreground">{pie}</div>}
    </div>
  )
}
