'use client'

import { useMemo, useState, useSyncExternalStore } from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown, Rows2, Rows3, Search } from 'lucide-react'
import {
  columnasOrdenables,
  filtrarFilas,
  ordenarFilas,
  siguienteOrden,
  textoDe,
  UMBRAL_CONTROLES,
  type CeldaReporte,
  type OrdenTabla,
} from '@/modules/reportes/tabla'

/**
 * LA TABLA DE LOS REPORTES (rediseño de reportes · Fase 7).
 *
 * Antes de esto había OCHO COPIAS idénticas de la misma función `Tabla`
 * —byte a byte, comprobado— al final de cada vista de reporte, con veintiséis
 * usos entre todas. Ninguna tenía un solo control: el orden era el que trajera
 * la consulta y no había forma de cambiarlo. Para responder «¿qué método movió
 * más dinero?» sobre una tabla de treinta filas había que recorrer la columna
 * con el dedo, o exportar el CSV y abrirlo en otro programa.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * LO QUE TIENE, Y LO QUE NO
 *
 * · **Ordenar por columna.** Pulsando el encabezado: primero de mayor a menor
 *   —en un reporte casi siempre se busca el mayor—, luego al revés, y a la
 *   tercera se quita y vuelve el orden del motor. Solo se puede ordenar lo que
 *   se puede ordenar bien: ver la nota de `tabla.ts` sobre `orden`.
 * · **Buscar.** Sobre el texto que se ve, sin acentos ni mayúsculas.
 * · **Densidad.** Cómoda o compacta. La elección se guarda en el navegador y
 *   vale para TODAS las tablas de reportes: cambiarla tabla por tabla sería
 *   una preferencia que hay que repetir nueve veces.
 * · **No hay paginación.** Los reportes agrupan hasta treinta o cincuenta
 *   filas y se imprimen: paginar escondería filas del papel sin avisar.
 * · **No hay multi-selección.** Una tabla de reporte es de solo lectura — no
 *   existe ninguna acción que aplicar a lo seleccionado. Una casilla que no
 *   lleva a ningún sitio enseña a desconfiar de los controles que sí sirven.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * IMPRIMIR
 *
 * Los controles no se imprimen; la tabla, sí, y entera. Pero si alguien
 * imprime con una búsqueda puesta, el papel enseñaría MENOS filas de las que
 * hay sin decirlo: por eso el aviso de «filtrado» se imprime con la tabla. El
 * orden elegido sí sale tal cual, que es lo que se está mirando.
 */
export function TablaReporte({
  encabezados,
  filas,
  vacio,
  /** Para el lector de pantalla cuando la tabla no lleva título encima. */
  etiqueta,
  buscarPlaceholder = 'Buscar en la tabla…',
}: {
  encabezados: string[]
  filas: CeldaReporte[][]
  vacio: string
  etiqueta?: string
  buscarPlaceholder?: string
}) {
  const [orden, setOrden] = useState<OrdenTabla | null>(null)
  const [q, setQ] = useState('')
  const compacta = useSyncExternalStore(suscribirDensidad, leerDensidad, () => false)

  const ordenables = useMemo(
    () => columnasOrdenables(filas, encabezados.length),
    [filas, encabezados.length]
  )
  const filtradas = useMemo(() => filtrarFilas(filas, q), [filas, q])
  const visibles = useMemo(() => ordenarFilas(filtradas, orden), [filtradas, orden])

  if (filas.length === 0) {
    return vacio ? <p className="text-small text-muted-foreground">{vacio}</p> : null
  }

  const conControles = filas.length > UMBRAL_CONTROLES
  const filtrando = q.trim().length > 0
  const alto = compacta ? 'py-1' : 'py-2'

  return (
    <div className="space-y-2">
      {conControles && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between print:hidden">
          <div className="relative sm:max-w-64 sm:flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={buscarPlaceholder}
              aria-label={etiqueta ? `Buscar en ${etiqueta}` : 'Buscar en la tabla'}
              className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-small text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <div
            className="flex items-center gap-1 self-end"
            role="group"
            aria-label="Densidad de la tabla"
          >
            <button
              type="button"
              onClick={() => escribirDensidad(false)}
              aria-pressed={!compacta}
              title="Densidad cómoda"
              className={`rounded-lg border p-1.5 ${
                compacta
                  ? 'border-border text-muted-foreground hover:text-foreground'
                  : 'border-primary/40 bg-primary/10 text-foreground'
              }`}
            >
              <Rows2 className="h-4 w-4" aria-hidden />
              <span className="sr-only">Cómoda</span>
            </button>
            <button
              type="button"
              onClick={() => escribirDensidad(true)}
              aria-pressed={compacta}
              title="Densidad compacta"
              className={`rounded-lg border p-1.5 ${
                compacta
                  ? 'border-primary/40 bg-primary/10 text-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              <Rows3 className="h-4 w-4" aria-hidden />
              <span className="sr-only">Compacta</span>
            </button>
          </div>
        </div>
      )}

      {/* Se imprime a propósito: un papel filtrado que no lo dice, miente. */}
      {filtrando && (
        <p className="text-caption text-muted-foreground">
          Filtrado por «{q.trim()}» — {visibles.length} de {filas.length} filas.
        </p>
      )}

      {visibles.length === 0 ? (
        <p className="text-small text-muted-foreground">
          Ninguna fila coincide con «{q.trim()}».
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-small" aria-label={etiqueta}>
            <thead>
              <tr className="border-b border-border text-left">
                {encabezados.map((h, i) => {
                  const activa = orden?.columna === i
                  const dir = activa ? orden.direccion : null
                  const clase = `${alto} text-overline ${i === 0 ? '' : 'text-right tabular-nums'}`
                  if (!ordenables[i]) {
                    return (
                      <th key={h} scope="col" className={clase}>
                        {h}
                      </th>
                    )
                  }
                  return (
                    <th
                      key={h}
                      scope="col"
                      className={clase}
                      aria-sort={
                        dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'
                      }
                    >
                      <button
                        type="button"
                        onClick={() => setOrden((o) => siguienteOrden(o, i))}
                        className={`inline-flex items-center gap-1 text-overline hover:text-foreground ${
                          i === 0 ? '' : 'flex-row-reverse'
                        } ${activa ? 'text-foreground' : ''}`}
                      >
                        {h}
                        {dir === 'asc' ? (
                          <ArrowUp className="h-3 w-3 print:hidden" aria-hidden />
                        ) : dir === 'desc' ? (
                          <ArrowDown className="h-3 w-3 print:hidden" aria-hidden />
                        ) : (
                          <ChevronsUpDown
                            className="h-3 w-3 opacity-40 print:hidden"
                            aria-hidden
                          />
                        )}
                      </button>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {visibles.map((fila) => (
                <tr key={fila.map(textoDe).join('|')} className="border-b border-border/60">
                  {fila.map((celda, i) => (
                    <td
                      key={i}
                      className={`${alto} ${
                        i === 0 ? 'text-foreground' : 'text-right tabular-nums text-foreground'
                      }`}
                    >
                      {textoDe(celda)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/**
 * LA DENSIDAD, COMPARTIDA POR TODAS LAS TABLAS DE LA PÁGINA.
 *
 * Una preferencia por tabla obligaría a repetir la misma elección nueve veces
 * en una pantalla, así que hay una sola clave — y un almacén mínimo para que,
 * al cambiarla en una tabla, las demás se enteren en el mismo instante. El
 * evento `storage` del navegador no sirve: no se dispara en la pestaña que
 * escribe, que es justo la que hay que actualizar.
 *
 * `useSyncExternalStore` y no un efecto: el servidor no tiene `localStorage`,
 * así que su instantánea es siempre «cómoda» y React reconcilia solo en la
 * hidratación. Leerlo en un efecto daría el mismo resultado con un parpadeo, y
 * además encadena renders.
 */
const CLAVE_DENSIDAD = 'membego.reportes.densidad'

const oyentes = new Set<() => void>()
let densidad: boolean | null = null

function leerDensidad(): boolean {
  if (densidad === null) {
    try {
      densidad = window.localStorage.getItem(CLAVE_DENSIDAD) === 'compacta'
    } catch {
      // Navegación privada o almacenamiento bloqueado: se queda en cómoda.
      densidad = false
    }
  }
  return densidad
}

function suscribirDensidad(avisar: () => void): () => void {
  oyentes.add(avisar)
  return () => {
    oyentes.delete(avisar)
  }
}

function escribirDensidad(v: boolean): void {
  densidad = v
  try {
    window.localStorage.setItem(CLAVE_DENSIDAD, v ? 'compacta' : 'comoda')
  } catch {
    // La tabla ya cambió; que no se recuerde no es motivo para romper nada.
  }
  for (const avisar of oyentes) avisar()
}
