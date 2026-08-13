import Link from 'next/link'
import Form from 'next/form'
import { Download, Search, Ticket as TicketIcon, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { TabsNav } from '@/components/ui/tabs-nav'
import { buttonVariants } from '@/components/ui/button'
import { desdeHace, plural } from '@/lib/plural'
import { COLA_LABEL, categoriaLabel, estadoBadgeClass, estadoLabel, type ColaTicket } from '@/lib/soporte'
import {
  AMBITOS,
  AMBITO_LABEL,
  COLAS,
  POR_PAGINA,
  estaParado,
  hayFiltro,
  hrefTickets,
  type FiltroTickets,
} from '@/modules/soporte/filtros'
import type { ListadoTickets } from '@/modules/soporte/queries'

/** Qué decir cuando una cola está vacía: no todas significan lo mismo. */
const VACIO: Record<ColaTicket, { titulo: string; descripcion: string }> = {
  pendientes: {
    titulo: 'Nada pendiente',
    descripcion: 'No hay tickets esperando respuesta. Buena señal.',
  },
  esperando: {
    titulo: 'Nadie esperando',
    descripcion: 'Ningún ticket está a la espera de que el cliente conteste.',
  },
  cerrados: {
    titulo: 'Sin tickets cerrados',
    descripcion: 'Todavía no se ha cerrado ninguno.',
  },
}

/**
 * LA BANDEJA, EN SERVIDOR.
 *
 * Era un componente de cliente que recibía las 200 filas que traía la consulta
 * y las filtraba con `useState` + `useMemo`. Tres consecuencias, las tres
 * silenciosas: al ticket 201 no se llegaba por ningún camino, buscar un cliente
 * cuyo ticket estaba fuera de esas 200 decía «sin resultados», y la cola
 * elegida no se podía compartir por enlace ni deshacer con el botón «atrás».
 *
 * Ahora todo va en la URL y filtra la base. Sin `'use client'`: no queda estado
 * que gestionar.
 */
export function TicketsTable({
  datos,
  f,
  base,
  detalleBase,
  mostrarEmpresa,
  mostrarAmbito,
}: {
  datos: ListadoTickets
  f: FiltroTickets
  base: string
  /** Prefijo del detalle: cada panel abre el ticket dentro de SÍ MISMO. */
  detalleBase: string
  mostrarEmpresa: boolean
  mostrarAmbito: boolean
}) {
  const paginas = Math.max(1, Math.ceil(datos.total / POR_PAGINA))

  return (
    <div className="space-y-4">
      {/* Colas en vez del desplegable "Todos los estados". El desplegable
          obligaba a saberse los cinco estados y a elegir uno para poder
          trabajar; las colas contestan directamente "¿qué me toca?".
          Los contadores salen de la BASE: contarlos sobre las filas cargadas
          haría que «Cerrados» dijera 25 cuando hay 900. */}
      <TabsNav
        aria-label="Colas de soporte"
        items={COLAS.map((c) => ({
          label: COLA_LABEL[c],
          badge: datos.porCola[c],
          active: c === f.cola,
          // Enlaces, no botones: la cola vive en la URL, así que se comparte y
          // el «atrás» del navegador deshace el cambio.
          render: ({ className, children }) => (
            <Link href={hrefTickets(f, base, { cola: c, pagina: 1 })} className={className}>
              {children}
            </Link>
          ),
        }))}
      />

      <div className="space-y-3">
        <Form action={base} className="flex flex-wrap items-end gap-3">
          {/* La cola viaja con el formulario: buscar no puede devolverte a
              «pendientes» cuando estabas mirando los cerrados. */}
          <input type="hidden" name="cola" value={f.cola} />
          {f.empresa && <input type="hidden" name="company" value={f.empresa} />}

          <div className="relative min-w-56 flex-1">
            <label htmlFor="q" className="mb-1 block text-caption text-muted-foreground">
              Buscar
            </label>
            <Search
              aria-hidden
              className="pointer-events-none absolute bottom-3 left-3 h-4 w-4 text-muted-foreground"
            />
            <input
              id="q"
              name="q"
              defaultValue={f.q}
              placeholder="Asunto o cliente…"
              className="h-10 w-full rounded-xl border border-input bg-background pl-9 pr-3 text-sm text-foreground"
            />
          </div>

          {mostrarAmbito && (
            <div>
              <label htmlFor="ambito" className="mb-1 block text-caption text-muted-foreground">
                Incluir
              </label>
              <select
                id="ambito"
                name="ambito"
                defaultValue={f.ambito}
                className="h-10 rounded-xl border border-input bg-background px-3 text-sm text-foreground"
              >
                {AMBITOS.map((a) => (
                  <option key={a} value={a}>
                    {AMBITO_LABEL[a]}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            type="submit"
            className="h-10 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Buscar
          </button>

          <Link
            href={hrefTickets(f, `${base}/exportar`)}
            prefetch={false}
            className={buttonVariants({ variant: 'secondary' })}
          >
            <Download className="mr-2 h-4 w-4" /> Exportar
          </Link>
        </Form>

        {hayFiltro(f) && (
          <div className="flex flex-wrap items-center gap-2">
            {f.q && (
              <Link
                href={hrefTickets(f, base, { q: '', pagina: 1 })}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-3 py-1 text-caption text-foreground hover:bg-muted"
                aria-label={`Quitar filtro «${f.q}»`}
              >
                «{f.q}» <X aria-hidden className="h-3 w-3" />
              </Link>
            )}
            {f.ambito !== 'reales' && (
              <Link
                href={hrefTickets(f, base, { ambito: 'reales', pagina: 1 })}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-3 py-1 text-caption text-foreground hover:bg-muted"
                aria-label={`Quitar filtro ${AMBITO_LABEL[f.ambito]}`}
              >
                {AMBITO_LABEL[f.ambito]} <X aria-hidden className="h-3 w-3" />
              </Link>
            )}
          </div>
        )}
      </div>

      {datos.filas.length === 0 ? (
        <EmptyState
          icon={<TicketIcon className="h-6 w-6" />}
          title={f.q ? 'Sin resultados' : VACIO[f.cola].titulo}
          description={
            f.q
              ? `Ningún ticket de esta cola coincide con «${f.q}».`
              : VACIO[f.cola].descripcion
          }
        />
      ) : (
        <ul className="list-none space-y-2">
          {datos.filas.map((t) => {
            const parado = estaParado(f.cola, t.desdeUltimoMovimiento)
            return (
              <li key={t.id}>
                <Link href={`${detalleBase}${t.id}`} className="block">
                  <Card className="transition hover:shadow-card-hover">
                    <CardContent className="flex items-center gap-4 py-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate font-medium text-foreground">{t.asunto}</p>
                          <Badge variant="secondary" className="text-caption">
                            {categoriaLabel(t.categoria)}
                          </Badge>
                          {t.empresaEsDemo && mostrarEmpresa && (
                            <Badge
                              variant="outline"
                              className="border-warning/40 bg-warning/10 text-caption text-warning"
                            >
                              Práctica
                            </Badge>
                          )}
                        </div>
                        <p className="mt-0.5 text-small text-muted-foreground">
                          {t.clienteNombre}
                          {mostrarEmpresa && <span> · {t.empresaNombre}</span>}
                          <span> · {plural(t.mensajes, 'mensaje', 'mensajes')}</span>
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <Badge className={estadoBadgeClass(t.estado)}>
                          {estadoLabel(t.estado)}
                        </Badge>
                        {/*
                          «hace 3 semanas», no «12 ago». Una bandeja de soporte
                          se prioriza por antigüedad, y una fecha suelta obliga
                          a calcularla de cabeza fila por fila. `<time>` deja el
                          dato exacto para quien lo necesite.
                        */}
                        <time
                          dateTime={t.actualizado.toISOString()}
                          className={
                            parado
                              ? 'text-caption font-medium text-warning'
                              : 'text-caption text-muted-foreground'
                          }
                        >
                          {parado && '⚠ '}
                          {desdeHace(t.desdeUltimoMovimiento)}
                        </time>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      {paginas > 1 && (
        <nav className="flex items-center justify-center gap-3 pt-2" aria-label="Paginación">
          <Link
            href={hrefTickets(f, base, { pagina: Math.max(1, f.pagina - 1) })}
            aria-disabled={f.pagina <= 1}
            className={`rounded-xl border border-input px-3 py-2 text-sm ${
              f.pagina <= 1 ? 'pointer-events-none opacity-40' : 'hover:bg-muted'
            }`}
          >
            Anterior
          </Link>
          <span className="text-small text-muted-foreground">
            Página {f.pagina} de {paginas}
          </span>
          <Link
            href={hrefTickets(f, base, { pagina: Math.min(paginas, f.pagina + 1) })}
            aria-disabled={f.pagina >= paginas}
            className={`rounded-xl border border-input px-3 py-2 text-sm ${
              f.pagina >= paginas ? 'pointer-events-none opacity-40' : 'hover:bg-muted'
            }`}
          >
            Siguiente
          </Link>
        </nav>
      )}
    </div>
  )
}
