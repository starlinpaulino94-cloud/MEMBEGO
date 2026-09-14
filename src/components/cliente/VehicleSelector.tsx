'use client'

import { Car, ChevronDown, Check } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import type { VehiculoLite } from '@/lib/vehiculoPlan'

/**
 * Selector rápido de vehículo (estilo Notion): un botón de texto discreto que
 * despliega los vehículos registrados. Con un solo vehículo no hay nada que
 * elegir, así que se muestra como texto plano.
 */
export function VehicleSelector({
  vehiculos,
  selectedId,
  onSelect,
  className,
}: {
  vehiculos: VehiculoLite[]
  selectedId: string
  onSelect: (id: string) => void
  className?: string
}) {
  const selected = vehiculos.find((v) => v.id === selectedId) ?? vehiculos[0]
  if (!selected) return null

  const nombre = `${selected.marca} ${selected.modelo}`

  if (vehiculos.length === 1) {
    return (
      <span className={cn('inline-flex items-center gap-1.5 font-semibold text-foreground', className)}>
        <Car className="h-4 w-4 text-muted-foreground" aria-hidden />
        {nombre}
      </span>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 font-semibold text-foreground transition-colors duration-fast hover:bg-retail-mist focus-visible:outline-2 focus-visible:outline-ring',
          className
        )}
        aria-label="Cambiar vehículo"
      >
        <Car className="h-4 w-4 text-muted-foreground" aria-hidden />
        {nombre}
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {vehiculos.map((v) => (
          <DropdownMenuItem
            key={v.id}
            onSelect={() => onSelect(v.id)}
            className="gap-2"
          >
            <Car className="h-4 w-4 text-muted-foreground" aria-hidden />
            {v.marca} {v.modelo}
            {v.id === selectedId && <Check className="ml-auto h-4 w-4 text-primary" aria-hidden />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
