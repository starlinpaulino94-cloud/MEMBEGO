import Link from 'next/link'
import { puedeFuncion } from '@/lib/auth/guards'
import { cn } from '@/lib/utils'

export type VistaInventario = 'existencias' | 'movimientos' | 'reservas' | 'entradas' | 'conteos' | 'transferencias' | 'valor' | 'compras' | 'proveedores'

const VISTAS: ReadonlyArray<{ id: VistaInventario; etiqueta: string; href: string }> = [
  { id: 'existencias', etiqueta: 'Existencias', href: '/admin/inventario' },
  { id: 'movimientos', etiqueta: 'Movimientos', href: '/admin/inventario/movimientos' },
  { id: 'reservas', etiqueta: 'Reservas', href: '/admin/inventario/reservas' },
  { id: 'entradas', etiqueta: 'Entradas', href: '/admin/inventario/entradas' },
  { id: 'conteos', etiqueta: 'Conteos', href: '/admin/inventario/conteos' },
  { id: 'transferencias', etiqueta: 'Transferencias', href: '/admin/inventario/transferencias' },
  { id: 'valor', etiqueta: 'Valor', href: '/admin/inventario/valor' },
  { id: 'compras', etiqueta: 'Compras', href: '/admin/inventario/compras' },
  { id: 'proveedores', etiqueta: 'Proveedores', href: '/admin/inventario/proveedores' },
]

/**
 * Las vistas de la empresa entera del inventario: lo que hay, lo que se movió,
 * lo que está apartado, la mercancía que entró, los inventarios físicos, las transferencias entre sucursales y lo que vale todo
 * (INV-3a) y las compras a proveedores (INV-3b). La ficha de UN producto cuelga de «Existencias».
 * Componente de servidor: son enlaces, no necesita estado. «Valor» solo aparece para quien tiene la función `costos`, y
 * «Compras» y «Proveedores» para quien tiene `comprar`: sin ellas la pantalla ni se ofrece (y, si alguien escribe la URL, la
 * propia página se lo niega).
 */
export async function NavegacionInventario({ actual }: { actual: VistaInventario }) {
  const [verValor, puedeComprar] = await Promise.all([puedeFuncion('inventario', 'costos'), puedeFuncion('inventario', 'comprar')])
  return (
    <nav aria-label="Vistas del inventario" className="flex flex-wrap gap-2">
      {VISTAS.filter((v) => (v.id !== 'valor' || verValor) && ((v.id !== 'compras' && v.id !== 'proveedores') || puedeComprar)).map((v) => (
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
