'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { useSesionDeLaLanding } from './AccionesDeSesion'

/**
 * «Volver al inicio» según quién sea (separación landing/app · F5).
 *
 * Las pantallas de error y de «no encontrada» las ve cualquiera, también quien está dentro de su espacio: a
 * esa persona «inicio» es SU casa (la app del cliente o su panel), no la portada comercial. El visitante sigue
 * yendo a `/`. Con JavaScript apagado o mientras llega la respuesta, el enlace es el de visitante: funciona
 * para todos, porque la portada es pública.
 */
export function EnlaceDeInicio({ etiqueta = 'Volver al inicio', etiquetaConSesion = 'Volver a mi espacio', variante, className }: { etiqueta?: string; etiquetaConSesion?: string; variante?: 'outline'; className?: string }) {
  const { puerta, sesion } = useSesionDeLaLanding()
  return (
    <Button asChild variant={variante} className={className}>
      <Link href={puerta?.href ?? '/'} data-sesion={sesion.estado}>
        {puerta ? etiquetaConSesion : etiqueta}
      </Link>
    </Button>
  )
}
