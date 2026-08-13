'use client'

import { Printer } from 'lucide-react'
import { Button } from './button'

/**
 * Dispara la impresión de la región marcada por `ReporteImprimible`.
 *
 * Va aparte del envoltorio porque `window.print()` obliga a que el componente
 * sea de cliente, y el envoltorio no tiene por qué serlo: así el reporte
 * entero se sigue renderizando en el servidor y solo este botón viaja al
 * navegador.
 *
 * La etiqueta dice «Imprimir o guardar PDF» y no solo «Imprimir» a propósito:
 * el diálogo del navegador ofrece «Guardar como PDF» en todos los sistemas, y
 * mucha gente que quiere el PDF no pulsa un botón que dice «imprimir» porque
 * cree que necesita una impresora conectada.
 */
export function BotonImprimir({
  label = 'Imprimir o guardar PDF',
  variant = 'secondary',
}: {
  label?: string
  variant?: 'secondary' | 'outline' | 'ghost'
}) {
  return (
    <Button type="button" variant={variant} onClick={() => window.print()} className="gap-2">
      <Printer className="h-4 w-4" aria-hidden />
      {label}
    </Button>
  )
}
