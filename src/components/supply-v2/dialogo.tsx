'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

/**
 * Botón que abre un formulario en un diálogo. El formulario llega como
 * `children` (un client component con su server action); el diálogo solo
 * decide si se ve.
 */
export function DialogoFormulario({
  etiqueta,
  titulo,
  descripcion,
  children,
  variant = 'default',
  testId,
  className,
  icono,
}: {
  etiqueta: string
  titulo: string
  descripcion?: string
  children: React.ReactNode
  variant?: React.ComponentProps<typeof Button>['variant']
  testId?: string
  /** Clases extra del botón que abre el diálogo (p. ej. el botón suave del Resumen). */
  className?: string
  /** Icono delante de la etiqueta. */
  icono?: React.ReactNode
}) {
  const [abierto, setAbierto] = useState(false)
  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogTrigger asChild>
        <Button variant={variant} data-testid={testId} className={className}>
          {icono}
          {etiqueta}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          {descripcion && <DialogDescription>{descripcion}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}
