'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * La galería del perfil (patrón Amazon): imagen grande + fila de miniaturas
 * con puntos de posición.
 *
 * Solo aparece cuando hay MÁS de una imagen; con una sola, la portada simple
 * de siempre dice lo mismo sin controles muertos. Las imágenes son las que la
 * empresa subió a `Promocion.imagenes` — el campo existía desde el principio
 * y ninguna pantalla lo enseñaba.
 *
 * `<img>` nativo a propósito, igual que la portada: el arte llega en un rango
 * de proporciones (1:1 a 4:5) y `next/image` exige declarar una por
 * adelantado, que es justo lo que no hay.
 */
export function GaleriaPromocion({ imagenes, alt }: { imagenes: string[]; alt: string }) {
  const [activa, setActiva] = useState(0)
  const actual = imagenes[activa] ?? imagenes[0]

  return (
    <div>
      <div className="overflow-hidden bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={actual} alt={alt} className="block h-auto w-full" />
      </div>

      <div
        className="no-scrollbar flex items-center gap-2 overflow-x-auto px-4 py-3"
        role="tablist"
        aria-label="Imágenes de la promoción"
      >
        {imagenes.map((src, i) => (
          <button
            key={src}
            type="button"
            role="tab"
            aria-selected={i === activa}
            aria-label={`Imagen ${i + 1} de ${imagenes.length}`}
            onClick={() => setActiva(i)}
            className={cn(
              'relative size-16 shrink-0 overflow-hidden rounded-lg border-2 outline-none transition-colors duration-fast focus-visible:ring-2 focus-visible:ring-primary',
              i === activa ? 'border-primary' : 'border-border hover:border-primary/40'
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt="" className="size-full object-cover" />
          </button>
        ))}
      </div>
    </div>
  )
}
