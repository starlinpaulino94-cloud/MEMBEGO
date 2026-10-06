import Link from 'next/link'
import Image from 'next/image'
import { Package } from 'lucide-react'
import { formatearPrecio } from '@/modules/catalog/formato'
import type { ItemPublicoResumen } from '@/modules/catalog/publico-nucleo'

/**
 * Tarjeta pública de un ítem del catálogo: la usan la vitrina de la empresa, el
 * descubrimiento entre empresas y el inicio. Componente de servidor, sin estado.
 */
export function TarjetaCatalogoPublica({
  item,
  mostrarEmpresa = false,
}: {
  item: ItemPublicoResumen
  mostrarEmpresa?: boolean
}) {
  return (
    <Link
      href={`/empresas/${item.company.slug}/catalogo/${item.slug}`}
      className="group overflow-hidden rounded-lg border border-border bg-card elevation-1 transition-colors duration-fast hover:border-primary/40"
    >
      <div className="relative aspect-[16/10] bg-muted">
        {item.imageUrl ? (
          <Image
            src={item.imageUrl}
            alt={item.name}
            fill
            className="object-cover transition group-hover:scale-105"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Package className="h-10 w-10 text-muted-foreground/30" aria-hidden />
          </div>
        )}
      </div>
      <div className="p-4">
        <h3 className="text-label-lg text-foreground">{item.name}</h3>
        {mostrarEmpresa && <p className="mt-1 text-caption text-muted-foreground">{item.company.name}</p>}
        {item.priceFrom != null && (
          <p className="mt-2 text-price-sm tabular-nums text-foreground">
            {item.hasVariants && <span className="mr-1 font-normal text-muted-foreground">Desde</span>}
            {formatearPrecio(item.priceFrom, item.currency)}
          </p>
        )}
      </div>
    </Link>
  )
}
