import type { LucideIcon } from 'lucide-react'
import { cn } from '../cn'

/**
 * AVISO DE TRABAJO PENDIENTE. Un número, qué significa, y a dónde ir a resolverlo.
 *
 * Se apaga cuando vale cero y se enciende cuando hay algo que hacer. Esa es toda
 * la idea: un panel donde SIEMPRE hay tres cuadros de colores enseña a no
 * mirarlos.
 *
 * EL COLOR NO PUEDE SER LA ÚNICA SEÑAL. La versión anterior de esto solo
 * cambiaba el borde y el fondo, así que para quien no distingue colores «0 pagos
 * por validar» y «12 pagos por validar» se veían igual salvo por el número —y el
 * número es justo lo que no se lee cuando se echa un vistazo rápido. Encendido,
 * el icono cambia de color Y de peso, y el conjunto lleva su propio texto para
 * lectores de pantalla.
 *
 * `<a>` nativo, no `Link`: este paquete no depende de Next. En rutas internas
 * Next lo intercepta igual.
 */
export function AlertTile({
  label,
  value,
  href,
  icon: Icon,
  tono = 'warning',
  sufijo,
}: {
  label: string
  value: number
  href: string
  icon: LucideIcon
  /** Qué clase de aviso es. Solo se aplica cuando hay algo pendiente. */
  tono?: 'warning' | 'info' | 'danger'
  /** Aclaración corta cuando el número solo no basta ("sin actividad en 14 días"). */
  sufijo?: string
}) {
  const activo = value > 0
  const TONOS = {
    warning: { borde: 'border-warning/30 bg-warning/10', icono: 'text-warning' },
    info: { borde: 'border-info/30 bg-info/10', icono: 'text-info' },
    danger: { borde: 'border-destructive/30 bg-destructive/10', icono: 'text-destructive' },
  }
  const t = TONOS[tono]

  return (
    <a
      href={href}
      aria-label={
        activo
          ? `${label}: ${value}${sufijo ? ` ${sufijo}` : ''}. Pendiente de atender.`
          : `${label}: ninguno pendiente.`
      }
      className={cn(
        'card-interactive flex items-center justify-between gap-3 rounded-xl border p-4',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        activo ? t.borde : 'border-border/60 bg-card shadow-card'
      )}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <Icon
          aria-hidden
          className={cn('h-4 w-4 shrink-0', activo ? t.icono : 'text-muted-foreground')}
          strokeWidth={activo ? 2.5 : 2}
        />
        <span className="min-w-0">
          <span className="block truncate text-small font-medium text-foreground">{label}</span>
          {sufijo && (
            <span className="block truncate text-caption text-muted-foreground">{sufijo}</span>
          )}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1 text-h3 tabular-nums text-foreground">
        {value}
        <span aria-hidden className="text-caption text-muted-foreground">
          →
        </span>
      </span>
    </a>
  )
}
