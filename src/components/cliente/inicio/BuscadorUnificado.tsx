'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { formatMoney } from '@/lib/format'
import type { BuscadorUnificadoResult } from '@/modules/cliente/actions'
import { Search, Tag, Compass, ChevronRight, X, AlertCircle, Clock, MapPin } from 'lucide-react'


export function BuscadorUnificado() {
  const [q, setQ] = useState('')
  const [resultados, setResultados] = useState<{
    promociones: BuscadorUnificadoResult['promociones']
    excursiones: BuscadorUnificadoResult['excursiones']
  } | null>(null)
  const [cargando, setCargando] = useState(false)
  // Solo interesa ESCRIBIRlo: abre y cierra el panel desde los manejadores.
  const [, setIsOpen] = useState(false)
  const [, startTransition] = useTransition()

  function buscar(e: React.FormEvent) {
    e.preventDefault()
    const limpio = q.trim()
    if (!limpio) {
      setResultados(null)
      setIsOpen(false)
      return
    }
    setCargando(true)
    startTransition(async () => {
      try {
        const res = await fetch(`/api/cliente/buscar-unificado?q=${encodeURIComponent(limpio)}`)
        if (res.ok) {
          const data = await res.json()
          if (!data.error) {
            setResultados({ promociones: data.promociones || [], excursiones: data.excursiones || [] })
            setIsOpen(true)
          }
        }
      } catch (e) {
        console.error('Error en búsqueda unificada:', e)
      } finally {
        setCargando(false)
      }
    })
  }

  function limpiar() {
    setQ('')
    setResultados(null)
    setIsOpen(false)
  }

  // Efecto para cerrar al hacer click fuera
  // (se maneja con el formulario y botón de limpiar)

  const hayResultados = resultados && (resultados.promociones.length > 0 || resultados.excursiones.length > 0)


  return (
    <section className="space-y-3" aria-label="Buscar ofertas y excursiones">
      <form onSubmit={buscar} role="search" className="relative">
        <div className="relative">
          {q && (
            <button
              type="button"
              onClick={limpiar}
              className="absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Limpiar búsqueda"
            >
              <X className="h-5 w-5" />
            </button>
          )}
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar ofertas, excursiones, destinos…"
            aria-label="Buscar ofertas y excursiones"
            className="w-full h-12 rounded-xl border border-border bg-card pl-11 pr-12 text-base text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20"
            autoComplete="off"
          />
        </div>
      </form>

      {cargando && (
        <div className="h-2 bg-primary/20 animate-pulse rounded-full" />
      )}

      {hayResultados && (
        <div className="space-y-6 animate-fade-up">
          {/* Promociones - PRIORIDAD ALTA */}
          {resultados!.promociones.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Tag className="h-4 w-4 text-primary" aria-hidden />
                  Promociones ({resultados!.promociones.length})
                </h3>
                <Link
                  href={`/cliente/promociones?q=${encodeURIComponent(q)}`}
                  className="text-sm font-medium text-primary hover:underline flex items-center gap-1"
                >
                  Ver todas <ChevronRight className="h-4 w-4" />
                </Link>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {resultados!.promociones.slice(0, 6).map((p) => (
                  <Link
                    key={p.id}
                    href={`/cliente/promociones/${p.id}`}
                    className="group overflow-hidden rounded-xl border bg-card shadow-sm transition hover:shadow-md hover:border-primary/30"
                  >
                    <div className="relative aspect-[4/3] bg-muted overflow-hidden">
                      {p.imagenUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.imagenUrl}
                          alt={p.titulo}
                          className="h-full w-full object-cover transition group-hover:scale-105"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <Tag className="h-10 w-10 text-muted-foreground/30" />
                        </div>
                      )}
                      <div className="absolute top-2 left-2 flex gap-1">
                        {p.tipo && (
                          <span className="rounded-full bg-background/80 px-2 py-0.5 text-xs font-medium backdrop-blur capitalize">
                            {p.tipo}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="p-3">
                      <h4 className="font-semibold line-clamp-1 group-hover:text-primary">{p.titulo}</h4>
                      <p className="mt-1 text-xs text-muted-foreground truncate">{p.company.name}</p>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-sm font-semibold text-primary">
                          {/* La promoción no lleva moneda propia: se usa el
                              formateador de la plataforma, con su moneda por
                              defecto. Antes leía `p.moneda`, que no existe. */}
                          {p.precio ? `Desde ${formatMoney(p.precio)}` : 'Ver detalle'}
                        </span>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary capitalize">{p.tipo}</span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* Actividades */}
          {resultados!.excursiones.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Compass className="h-4 w-4 text-primary" aria-hidden />
                  Actividades ({resultados!.excursiones.length})
                </h3>
                <Link
                  href={`/excursiones?q=${encodeURIComponent(q)}`}
                  className="text-sm font-medium text-primary hover:underline flex items-center gap-1"
                >
                  Ver todas <ChevronRight className="h-4 w-4" />
                </Link>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {resultados!.excursiones.slice(0, 6).map((e) => (
                  <Link
                    key={e.id}
                    href={`/empresas/${e.empresa.slug}/excursiones/${e.slug}`}
                    className={`group overflow-hidden rounded-xl border bg-card shadow-sm transition hover:shadow-md ${e.agotadaGlobal || e.todasFechasPasadas ? 'opacity-50 pointer-events-none' : ''}`}
                  >
                    <div className="relative aspect-[16/10] bg-muted">
                      {e.portadaUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={e.portadaUrl}
                          alt={e.nombre}
                          className="h-full w-full object-cover transition group-hover:scale-105"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <Compass className="h-10 w-10 text-muted-foreground/30" />
                        </div>
                      )}
                      {e.categoria && (
                        <span className="absolute left-2 top-2 rounded-full bg-background/80 px-2 py-0.5 text-xs font-medium backdrop-blur">
                          {e.categoria}
                        </span>
                      )}
                      {(e.agotadaGlobal || e.todasFechasPasadas) && (
                        <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                          <span className="rounded-full bg-background/90 px-3 py-1 text-sm font-semibold text-destructive flex items-center gap-1.5">
                            {e.todasFechasPasadas ? (
                              <> <X className="h-4 w-4" /> Finalizada </> 
                            ) : (
                              <> <AlertCircle className="h-4 w-4" /> Agotada </>
                            )}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="p-3">
                      <h4 className="font-semibold line-clamp-1 group-hover:text-primary">{e.nombre}</h4>
                      <p className="mt-1 text-xs text-muted-foreground truncate">{e.empresa.name}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {e.duracionMin && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {e.duracionMin} min
                          </span>
                        )}
                        {e.ubicacion && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {e.ubicacion}
                          </span>
                        )}
                      </div>
                      {e.precioDesde != null && (
                        <p className="mt-2 text-sm font-semibold text-primary">
                          Desde {new Intl.NumberFormat('es-DO', { style: 'currency', currency: e.moneda, minimumFractionDigits: 0 }).format(e.precioDesde)}
                        </p>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
              <div className="flex justify-center pt-2">
                <Link
                  href={`/excursiones?q=${encodeURIComponent(q)}`}
                  className="text-sm font-medium text-primary hover:underline flex items-center gap-1"
                >
                  Ver todas las excursiones <ChevronRight className="h-4 w-4" />
                </Link>
              </div>
            </section>
          )}
        </div>
      )}
    </section>
  )
}