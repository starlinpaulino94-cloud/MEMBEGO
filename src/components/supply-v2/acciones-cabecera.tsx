import Link from 'next/link'
import Form from 'next/form'
import { ListFilter, Plus } from 'lucide-react'

/**
 * Acciones de la cabecera común de Supply 2.0 (Stitch): el filtro rápido y
 * «Nuevo Pedido». El filtro envía `?q=` a la pantalla en la que está, que
 * decide qué acota (en el Resumen, inventario y órdenes; en Compras, la tabla).
 */
export function AccionesCabeceraSupplyV2({ destino, filtro }: { destino: string; filtro: string }) {
  return (
    <>
      <Form action={destino} className="relative flex items-center" role="search">
        <ListFilter aria-hidden className="pointer-events-none absolute left-2 size-[18px] text-sv2-ink-variant" />
        <label htmlFor="filtro-rapido" className="sr-only">Filtro rápido por SKU o proveedor</label>
        <input
          id="filtro-rapido"
          name="q"
          type="search"
          defaultValue={filtro}
          placeholder="Filtro rápido SKU o proveedor..."
          className="h-8 w-full rounded-[8px] bg-sv2-well pl-8 pr-2 text-[13px] leading-[18px] text-foreground placeholder:text-sv2-outline focus:outline-none focus:ring-1 focus:ring-sv2-accent @xl:w-60"
          data-testid="filtro-rapido"
        />
      </Form>
      <Link
        href="/superadmin/supply-v2/compras/nueva"
        data-testid="btn-nueva-compra"
        className="inline-flex h-8 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-[8px] bg-sv2-accent px-3 text-[13px] font-semibold leading-4 text-white transition-colors hover:bg-sv2-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sv2-accent focus-visible:ring-offset-2"
      >
        <Plus aria-hidden className="size-4" />
        <span>Nuevo Pedido</span>
      </Link>
    </>
  )
}
