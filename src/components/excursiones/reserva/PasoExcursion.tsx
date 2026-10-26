'use client'

import { useMemo } from 'react'
import Image from 'next/image'
import { Check, Clock, MapPin, Search } from 'lucide-react'
import { Campo } from '@/components/ui/campo'
import { Input } from '@/components/ui/input'
import { formatPrice } from '@/lib/format'
import type { ExcursionOpcion } from '@/modules/excursiones/reservas/formulario'
import { Paso } from './Paso'
import type { PasoProps } from './tipos'

/** Las excursiones que coinciden con lo escrito en el buscador (nombre, categoría o ubicación). */
function filtrar(excursiones: ExcursionOpcion[], busqueda: string): ExcursionOpcion[] {
  const q = busqueda.toLowerCase().trim()
  if (!q) return excursiones
  return excursiones.filter(
    (e) =>
      e.nombre.toLowerCase().includes(q) ||
      (e.categoria && e.categoria.toLowerCase().includes(q)) ||
      (e.ubicacion && e.ubicacion.toLowerCase().includes(q))
  )
}

/** PASO 1 · elegir la excursión o el paquete, con buscador y tarjetas. */
export function PasoExcursion({
  v,
  poner,
  errores,
  excursiones,
}: PasoProps & { excursiones: ExcursionOpcion[] }) {
  const visibles = useMemo(() => filtrar(excursiones, v.busquedaExcursion), [excursiones, v.busquedaExcursion])

  return (
    <Paso
      numero={1}
      id="paso-excursion"
      titulo="Selecciona la excursión o paquete"
      aside={<span className="text-xs font-medium text-muted-foreground">{visibles.length} disponibles</span>}
    >
      <Campo id="reserva-buscar-excursion" etiqueta="Buscar en el catálogo" opcional>
        {(control) => (
          <div className="relative w-full min-w-0">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Nombre, categoría o ubicación…"
              value={v.busquedaExcursion}
              onChange={(e) => poner({ busquedaExcursion: e.target.value })}
              className="h-11 w-full bg-background pl-9 text-xs sm:text-sm"
              {...control}
            />
          </div>
        )}
      </Campo>

      <Campo id="reserva-excursion" como="grupo" etiqueta="Excursiones y paquetes" error={errores.excursionId}>
        {() => (
          <div className="grid max-h-[360px] w-full min-w-0 grid-cols-1 gap-3 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
            {visibles.length === 0 ? (
              <p className="col-span-full py-6 text-center text-sm text-muted-foreground">Ninguna excursión coincide con la búsqueda.</p>
            ) : null}
            {visibles.map((e) => {
              const elegida = e.id === v.excursionId
              const minPrecio = Math.min(...e.variantes.map((x) => x.precioAdulto))
              const esCombo = e.tipoItem === 'COMBO'
              const esPase = e.tipoItem === 'PASE_DIA'
              return (
                <button
                  type="button"
                  key={e.id}
                  aria-pressed={elegida}
                  onClick={() =>
                    poner({ excursionId: e.id, varianteId: e.variantes[0]?.id ?? '', hora: e.horarios?.[0]?.horaSalida ?? '' })
                  }
                  className={`group relative flex w-full min-w-0 flex-col rounded-xl border p-3 text-left transition-all active:scale-[0.98] ${
                    elegida ? 'border-primary bg-primary/5 shadow-sm ring-2 ring-primary/20' : 'border-border bg-card hover:border-primary/40 hover:bg-muted/30'
                  }`}
                >
                  <div className="relative mb-2.5 aspect-video w-full overflow-hidden rounded-lg bg-muted">
                    {e.portadaUrl ? (
                      <Image
                        src={e.portadaUrl}
                        alt={e.nombre}
                        fill
                        className="object-cover transition group-hover:scale-105"
                        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs font-medium text-muted-foreground/40">Sin imagen</div>
                    )}
                    <span
                      className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-xs font-bold shadow-xs ${
                        esCombo ? 'bg-warning text-white' : esPase ? 'bg-success text-white' : 'bg-primary text-primary-foreground'
                      }`}
                    >
                      {esCombo ? 'Combo' : esPase ? 'Daypass' : 'Actividad'}
                    </span>
                  </div>

                  <div className="flex w-full min-w-0 flex-1 flex-col justify-between space-y-2">
                    <div className="w-full min-w-0">
                      <p className="line-clamp-1 text-xs font-bold text-foreground transition-colors group-hover:text-primary sm:text-sm">{e.nombre}</p>
                      <div className="mt-0.5 flex items-center gap-2 truncate text-xs text-muted-foreground">
                        {e.duracionMin && (
                          <span className="flex shrink-0 items-center gap-0.5">
                            <Clock className="h-3 w-3" />
                            {e.duracionMin}m
                          </span>
                        )}
                        {e.ubicacion && (
                          <span className="flex items-center gap-0.5 truncate">
                            <MapPin className="h-3 w-3 shrink-0" />
                            {e.ubicacion}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex w-full min-w-0 items-center justify-between border-t border-border/50 pt-2 text-xs">
                      <span className="text-xs text-muted-foreground">Desde</span>
                      <span className="truncate font-mono font-bold text-primary">{formatPrice(minPrecio, { moneda: e.moneda })}</span>
                    </div>
                  </div>

                  {elegida && (
                    <div className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xs">
                      <Check className="h-3 w-3 stroke-[3]" />
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </Campo>
    </Paso>
  )
}
