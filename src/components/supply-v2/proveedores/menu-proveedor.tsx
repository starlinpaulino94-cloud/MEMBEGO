'use client'

import Link from 'next/link'
import { MoreVertical, Package, ReceiptText, ShoppingCart } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

/** Menú ⋮ de cada proveedor (Stitch): nueva compra, su catálogo y su historial de pagos. */
export function MenuProveedor({ id, nombre }: { id: string; nombre: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Más acciones de ${nombre}`}
        className="flex size-8 items-center justify-center rounded-[8px] text-sv2-outline transition-colors hover:bg-sv2-soft hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sv2-accent"
        data-testid="menu-proveedor"
      >
        <MoreVertical aria-hidden className="size-[18px]" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48 text-[13px]">
        <DropdownMenuItem asChild>
          <Link href="/superadmin/supply/compras/nueva"><ShoppingCart aria-hidden className="size-4" /> Nueva compra</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/superadmin/supply/proveedores/${id}`}><Package aria-hidden className="size-4" /> Ver catálogo</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/superadmin/supply/finanzas/pagos?proveedor=${id}`}><ReceiptText aria-hidden className="size-4" /> Historial de pagos</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
