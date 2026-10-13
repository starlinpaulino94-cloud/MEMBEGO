import Link from 'next/link'
import { cn } from '@/lib/utils'

export type VistaInventario = 'existencias' | 'movimientos' | 'reservas'

const VISTAS: ReadonlyArray<{ id: VistaInventario; etiqueta: string; href: string }> = [
  { id: 'existencias', etiqueta: 'Existencias', href: '/admin/inventario' },
  { id: 'movimientos', etiqueta: 'Movimientos', href: '/admin/inventario/movimientos' },
  { id: 'reservas', etiqueta: 'Reservas', href: '/admin/inventario/reservas' },
]

/**
 * Las tres vistas de la empresa entera del inventario: lo que hay, lo que se
 * movió y lo que está apartado. La ficha de UN producto cuelga de «Existencias».
 * Componente de servidor: son tres enlaces, no necesita estado.
 */
export function NavegacionInventario({ actual }: { actual: VistaInventario }) {
  return (
    <nav aria-label="Vistas del inventario" className="flex flex-wrap gap-2">
      {VISTAS.map((v) => (
        <Link
          key={v.id}
          href={v.href}
          aria-current={v.id === actual ? 'page' : undefined}
          className={cn(
            'inline-flex h-9 items-center rounded-lg border px-3 text-sm transition-colors',
            v.id === actual ? 'border-primary/40 bg-muted font-medium text-foreground' : 'border-input text-muted-foreground hover:bg-muted/60 hover:text-foreground'
          )}
        >
          {v.etiqueta}
        </Link>
      ))}
    </nav>
  )
}
