'use client'

import { useEffect, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * COPIAR AL PORTAPAPELES, con confirmación en el propio botón.
 *
 * «¡Copiado!» durante dos segundos y vuelta a «Copiar». Si el portapapeles
 * falla (permisos, contexto inseguro), el botón NO miente: se queda en
 * «Copiar» y el texto sigue a la vista para copiarlo a mano.
 *
 * Es el único trozo de cliente que necesita un bloque de código; el bloque en
 * sí se pinta en el servidor.
 */
export function BotonCopiar({ texto, className }: { texto: string; className?: string }) {
  const [copiado, setCopiado] = useState(false)

  useEffect(() => {
    if (!copiado) return
    const t = setTimeout(() => setCopiado(false), 2000)
    return () => clearTimeout(t)
  }, [copiado])

  return (
    <button
      type="button"
      onClick={() =>
        navigator.clipboard
          .writeText(texto)
          .then(() => setCopiado(true))
          .catch(() => setCopiado(false))
      }
      aria-live="polite"
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-lg border border-sidebar-border bg-sidebar px-2.5 text-caption font-semibold text-sidebar-accent-foreground outline-none transition-colors duration-fast hover:bg-sidebar-hover focus-visible:ring-2 focus-visible:ring-ring',
        className
      )}
    >
      {copiado ? (
        <>
          <Check className="h-3.5 w-3.5 text-success" aria-hidden />
          ¡Copiado!
        </>
      ) : (
        <>
          <Copy className="h-3.5 w-3.5" aria-hidden />
          Copiar
        </>
      )}
    </button>
  )
}
