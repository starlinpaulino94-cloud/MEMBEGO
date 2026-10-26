import { Fragment, type ReactNode } from 'react'
import { cn } from '../cn'
import { Button } from './button'
import { Input } from './input'

export interface OpcionFiltro {
  valor: string
  etiqueta: string
}

export interface FiltroSelect {
  /** Nombre del parámetro en la URL (`?estado=…`). */
  nombre: string
  etiqueta: string
  /** Valor actual, leído de la URL. Vacío = sin filtro. */
  valor: string
  opciones: readonly OpcionFiltro[]
  /** Texto de «sin filtro». Por defecto, «{etiqueta}: todos». */
  todas?: string
}

export interface BusquedaFiltro {
  nombre: string
  valor: string
  etiqueta: string
  placeholder?: string
}

export interface FiltroFecha {
  /** Nombre del parámetro en la URL (`?desde=2026-10-01`). */
  nombre: string
  etiqueta: string
  /** Valor actual, leído de la URL, como `AAAA-MM-DD`. Vacío = sin filtro. */
  valor: string
}

/** `2026-10-01` → `01/10/2026` (lo que se dice en el chip); lo que no es una fecha ISO se deja como viene. */
function fechaLegible(valor: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(valor) ? valor.split('-').reverse().join('/') : valor
}

type EnlaceBarra = (props: { href: string; className: string; 'aria-label'?: string; children: ReactNode }) => ReactNode

const enlaceNativo: EnlaceBarra = ({ href, className, children, ...resto }) => (
  <a href={href} className={className} {...resto}>
    {children}
  </a>
)

interface BarraFiltrosProps {
  /** URL a la que se envía el formulario. Por defecto, la misma pantalla. */
  action?: string
  busqueda?: BusquedaFiltro
  filtros?: readonly FiltroSelect[]
  /** Fechas (un rango son dos: «desde» y «hasta»). Van en la URL como `AAAA-MM-DD`, igual que los demás filtros. */
  fechas?: readonly FiltroFecha[]
  /** Parámetros que NO son filtros pero tienen que sobrevivir al enviar (la cola, el orden). */
  conservar?: Readonly<Record<string, string>>
  /** La URL de esta pantalla sin ese parámetro: lo que hace el chip «✕». */
  hrefSin: (nombre: string) => string
  /** La URL de esta pantalla sin ningún filtro. */
  hrefLimpiar: string
  enlace?: EnlaceBarra
  className?: string
}

const CLASES_SELECT =
  'h-10 rounded-xl border border-input bg-background px-3 text-sm shadow-sm outline-none transition-[color,box-shadow,border-color] duration-fast hover:border-foreground/25 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30'

/**
 * La barra de filtros de una lista (docs/auditoria-admin/06 §4, regla 5): los filtros viajan en la URL, SIEMPRE.
 *
 * Es un `<form method="get">`: funciona sin JavaScript, la lista filtrada se comparte y sobrevive a recargar. Debajo van los
 * filtros activos como chips que se quitan con un clic, y «Limpiar». Sustituye la cadena «Aplicar filtros» que hoy está
 * copiada en cinco sitios (07 · FE-05).
 *
 * De SERVIDOR: lee la URL en la página y le pasa los valores; no guarda estado.
 */
export function BarraFiltros({
  action = '',
  busqueda,
  filtros = [],
  fechas = [],
  conservar = {},
  hrefSin,
  hrefLimpiar,
  enlace = enlaceNativo,
  className,
}: BarraFiltrosProps) {
  const activos: { nombre: string; texto: string }[] = []
  if (busqueda?.valor) activos.push({ nombre: busqueda.nombre, texto: `${busqueda.etiqueta}: ${busqueda.valor}` })
  for (const f of filtros) {
    if (!f.valor) continue
    const opcion = f.opciones.find((o) => o.valor === f.valor)
    if (opcion) activos.push({ nombre: f.nombre, texto: `${f.etiqueta}: ${opcion.etiqueta}` })
  }

  for (const f of fechas) {
    if (f.valor) activos.push({ nombre: f.nombre, texto: `${f.etiqueta}: ${fechaLegible(f.valor)}` })
  }

  return (
    <div data-slot="barra-filtros" className={cn('grid gap-2', className)}>
      <form method="get" action={action} role="search" className="flex flex-wrap items-center gap-2">
        {Object.entries(conservar).map(([nombre, valor]) => (
          <input key={nombre} type="hidden" name={nombre} value={valor} />
        ))}
        {busqueda && (
          <div className="min-w-[200px] flex-1 sm:max-w-xs">
            <label htmlFor={`filtro-${busqueda.nombre}`} className="sr-only">
              {busqueda.etiqueta}
            </label>
            <Input
              id={`filtro-${busqueda.nombre}`}
              type="search"
              name={busqueda.nombre}
              defaultValue={busqueda.valor}
              placeholder={busqueda.placeholder ?? busqueda.etiqueta}
            />
          </div>
        )}
        {filtros.map((f) => (
          <div key={f.nombre}>
            <label htmlFor={`filtro-${f.nombre}`} className="sr-only">
              {f.etiqueta}
            </label>
            <select id={`filtro-${f.nombre}`} name={f.nombre} defaultValue={f.valor} className={CLASES_SELECT}>
              <option value="">{f.todas ?? `${f.etiqueta}: todos`}</option>
              {f.opciones.map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.etiqueta}
                </option>
              ))}
            </select>
          </div>
        ))}
        {fechas.map((f) => (
          <div key={f.nombre} className="flex items-center gap-1.5">
            <label htmlFor={`filtro-${f.nombre}`} className="whitespace-nowrap text-small text-muted-foreground">
              {f.etiqueta}
            </label>
            <Input id={`filtro-${f.nombre}`} type="date" name={f.nombre} defaultValue={f.valor} className="w-40" />
          </div>
        ))}
        <Button type="submit" variant="secondary">
          Aplicar
        </Button>
      </form>
      {activos.length > 0 && (
        <div aria-label="Filtros activos" role="group" className="flex flex-wrap items-center gap-2">
          {activos.map((a) => (
            <Fragment key={a.nombre}>
              {enlace({
                href: hrefSin(a.nombre),
                'aria-label': `Quitar el filtro ${a.texto}`,
                className:
                  'inline-flex h-7 items-center gap-1.5 rounded-full bg-primary/10 px-2.5 text-small font-medium text-primary hover:bg-primary/15',
                children: (
                  <>
                    {a.texto} <span aria-hidden>✕</span>
                  </>
                ),
              })}
            </Fragment>
          ))}
          {enlace({ href: hrefLimpiar, className: 'text-small font-medium text-primary hover:underline', children: 'Limpiar' })}
        </div>
      )}
    </div>
  )
}
