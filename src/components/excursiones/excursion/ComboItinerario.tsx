'use client'

import { AlertTriangle, Check, Clock, Sparkles } from 'lucide-react'
import { agruparBloques, DIAS_NOMBRES, formato12h } from '@/modules/excursiones/catalogo/formulario'
import type { ComboEstado } from './useCombo'

/**
 * El itinerario del combo «del mismo día»: si las actividades se cruzan o no, el orden de los bloques (las que se permiten
 * solapar CONTIENEN a las que caen dentro) y las combinaciones de turnos que el cliente podrá elegir.
 */
export function ComboItinerario({ combo, duracionHoras }: { combo: ComboEstado; duracionHoras: number }) {
  const { itinerario, diasComunes, actividadesConHorario, pasesDia, combinaciones } = combo
  const { raiz, hijosDe } = agruparBloques(itinerario.itinerario)

  return (
    <>
      <div className="space-y-2.5 rounded-xl border border-border/80 bg-card p-3.5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" aria-hidden />
            <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">Itinerario del mismo día</h4>
          </div>
          <div className="text-caption font-medium">
            {diasComunes.length > 0 ? (
              <span className="text-muted-foreground">
                Días comunes: <span className="font-semibold text-foreground">{diasComunes.map((d) => DIAS_NOMBRES[d]).join(', ')}</span>
              </span>
            ) : (
              <span className="font-semibold text-destructive">⚠️ No hay días de salida en común entre las actividades</span>
            )}
          </div>
        </div>

        {itinerario.ok ? (
          <div className="flex items-center gap-2 rounded-lg bg-success/10 px-3 py-1.5 text-xs font-medium text-success">
            <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              {actividadesConHorario.length > 0
                ? `Secuencia coordinada sin cruces de horario (${duracionHoras}h en total en el día).`
                : 'Pase(s) con acceso libre para la fecha seleccionada.'}
            </span>
          </div>
        ) : (
          <div role="alert" className="flex items-start gap-2 rounded-lg bg-destructive/10 p-2.5 text-xs font-medium text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div>
              <p className="font-bold">{itinerario.error}</p>
              <p className="mt-0.5 text-xs opacity-90">
                Haz clic en «Auto-sincronizar turnos» arriba o cambia los turnos para resolver el conflicto.
              </p>
            </div>
          </div>
        )}

        {itinerario.itinerario.length > 0 && (
          <div className="space-y-1.5 pt-1">
            {raiz.map((bloque, idx) => {
              const hijos = hijosDe(bloque)
              const esContenedor = hijos.length > 0
              return (
                <div
                  key={bloque.id || idx}
                  className={`rounded-lg border px-3 py-2 text-xs ${esContenedor ? 'space-y-1.5 border-primary/30 bg-primary/5' : 'border-border/60 bg-muted/40'}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{idx + 1}</span>
                      <span className="font-medium text-foreground">{bloque.nombre}</span>
                      {esContenedor && <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-xs font-bold text-primary">Contenedor</span>}
                    </div>
                    <div className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">{formato12h(bloque.inicio)}</span>
                      <span>→</span>
                      <span className="font-semibold text-foreground">{formato12h(bloque.fin)}</span>
                      <span>({(bloque.duracionMin / 60).toFixed(1)}h)</span>
                    </div>
                  </div>
                  {hijos.length > 0 && (
                    <div className="ml-7 space-y-1 border-l-2 border-primary/20 pl-2.5">
                      {hijos.map((hijo, hIdx) => (
                        <div key={hijo.id || hIdx} className="flex items-center justify-between rounded-lg border border-warning/30 bg-warning/5 px-2.5 py-1.5">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-warning" aria-hidden>↳</span>
                            <span className="font-medium text-foreground">{hijo.nombre}</span>
                            <span className="rounded-full bg-warning/10 px-1.5 py-0.5 text-xs font-bold text-warning">Anidada</span>
                          </div>
                          <div className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                            <span className="font-semibold text-foreground">{formato12h(hijo.inicio)}</span>
                            <span>→</span>
                            <span className="font-semibold text-foreground">{formato12h(hijo.fin)}</span>
                            <span>({(hijo.duracionMin / 60).toFixed(1)}h)</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
        {itinerario.itinerario.length === 0 && pasesDia.length > 0 && (
          <div className="rounded-lg border border-dashed border-success/30 bg-success/5 p-2.5 text-center text-xs font-medium text-success">
            Acceso libre durante todo el día para la fecha reservada
          </div>
        )}
      </div>

      {combinaciones.length > 0 && (
        <div className="space-y-2 rounded-xl border border-primary/20 bg-primary/5 p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-1">
            <span className="flex items-center gap-1.5 text-xs font-bold text-primary">
              <Sparkles className="h-4 w-4" aria-hidden />
              Opciones de turnos del paquete ({combinaciones.length} disponibles)
            </span>
            <span className="text-xs text-muted-foreground">Guardadas automáticamente en el catálogo</span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {combinaciones.map((c, i) => (
              <div key={c.id || i} className="space-y-1 rounded-lg border border-border/80 bg-background/90 p-2.5 text-xs shadow-2xs">
                <div className="flex items-center justify-between font-semibold">
                  <span className="text-foreground">{c.nombre}</span>
                  <span className="font-mono font-bold text-primary">
                    {formato12h(c.horaInicio)} → {formato12h(c.horaFin)}
                  </span>
                </div>
                <p className="line-clamp-1 text-xs text-muted-foreground">{c.resumenTexto}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
