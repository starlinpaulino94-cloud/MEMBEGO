'use client'

import { Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Dispara el diálogo de impresión del navegador. Vive en su propio archivo de
 * cliente para que la página del comprobante siga siendo de servidor: así el
 * papel se arma con los datos ya leídos y no depende de nada del navegador.
 */
export function BotonImprimir() {
  return (
    <Button onClick={() => window.print()} className="w-full">
      <Printer className="mr-2 h-4 w-4" aria-hidden /> Imprimir
    </Button>
  )
}
