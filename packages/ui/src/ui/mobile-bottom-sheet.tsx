'use client'

import * as React from 'react'
import { cn } from '../cn'

/**
 * Hoja inferior para móvil: la lista de resultados que convive con un mapa a
 * pantalla completa.
 *
 * DOS ESTADOS, NO ARRASTRE LIBRE. Se puede asomar (`peek`, deja ver el mapa)
 * o abrir (`full`), y se alterna con el tirador. Se descartó el arrastre
 * continuo a propósito: exige gestión de punteros, momento y rebote, se pelea
 * con el scroll interno de la lista y es prácticamente imposible de manejar
 * con teclado. Dos estados y un botón real cubren el mismo trabajo, funcionan
 * sin JavaScript de gestos y son accesibles sin inventar nada.
 *
 * NO es un diálogo: el mapa de detrás sigue siendo interactivo a propósito
 * —mover el mapa actualiza la lista—, así que nada de `role="dialog"`,
 * `aria-modal` ni trampa de foco. Es una región complementaria.
 *
 * Solo existe en móvil. En pantallas grandes el llamador coloca la lista en
 * una columna al lado y esta pieza se oculta con `lg:hidden`.
 */
export function MobileBottomSheet({
  abierta,
  onToggle,
  titulo,
  resumen,
  children,
  className,
}: {
  abierta: boolean
  onToggle: (abierta: boolean) => void
  /** Texto del tirador; también es la etiqueta accesible del botón. */
  titulo: string
  /** Línea secundaria visible cuando está asomada: recuento, zona… */
  resumen?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  const idContenido = React.useId()

  return (
    <section
      aria-label={titulo}
      className={cn(
        'pointer-events-none fixed inset-x-0 bottom-0 z-40 flex flex-col lg:hidden',
        className
      )}
    >
      <div
        className={cn(
          'pointer-events-auto mx-auto flex w-full max-w-2xl flex-col rounded-t-2xl border border-b-0 border-border bg-card elevation-3',
          'transition-[max-height] duration-300 ease-out',
          abierta ? 'max-h-[75svh]' : 'max-h-[8.5rem]'
        )}
        // La barra inferior de navegación vive debajo: sin este hueco, la hoja
        // abierta la tapa y deja al usuario sin salida.
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 4.5rem)' }}
      >
        <button
          type="button"
          onClick={() => onToggle(!abierta)}
          aria-expanded={abierta}
          aria-controls={idContenido}
          className="flex shrink-0 flex-col items-center gap-1.5 rounded-t-2xl px-4 pb-2 pt-2.5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <span aria-hidden className="h-1 w-10 rounded-full bg-border" />
          <span className="flex w-full items-baseline justify-between gap-3">
            <span className="text-h4 text-foreground">{titulo}</span>
            {resumen && <span className="truncate text-caption">{resumen}</span>}
          </span>
          <span className="sr-only">{abierta ? 'Contraer la lista' : 'Ver la lista completa'}</span>
        </button>

        <div
          id={idContenido}
          className={cn(
            'min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-1',
            !abierta && 'pointer-events-none'
          )}
          // `inert` cuando está asomada: si no, se puede tabular hacia tarjetas
          // que están fuera de la vista y el foco se va a un sitio invisible.
          inert={!abierta}
        >
          {children}
        </div>
      </div>
    </section>
  )
}
