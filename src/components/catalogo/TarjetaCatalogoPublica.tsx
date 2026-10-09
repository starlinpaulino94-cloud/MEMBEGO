import Link from 'next/link'
import Image from 'next/image'
import { Package } from 'lucide-react'
import { formatearPrecio } from '@/modules/catalog/formato'
import { ETIQUETA_DISPONIBILIDAD, RUTA_OFERTAS_MEMBEGO, type ItemPublicoResumen } from '@/modules/catalog/publico-nucleo'
import type { OfertaPublica } from '@/modules/deals/publico-nucleo'
import { ctaDelItem, esServicio, porcentajeDeAhorro } from '@/modules/comercio/vitrina'

/**
 * Tarjeta pública de un ítem del catálogo: la usan la vitrina de la empresa, el
 * descubrimiento entre empresas y el inicio. Componente de servidor, sin estado.
 *
 * Enseña, según aplique: imagen, nombre, empresa, precio, precio anterior,
 * % de descuento y distintivo de oferta (si hay una oferta VIVA sobre el ítem),
 * disponibilidad («Disponible» / «Pocas unidades» / «Agotado», nunca la
 * cantidad), si es servicio o producto para recoger, y el botón según el caso.
 * No recibe nada interno: solo proyecciones públicas.
 */
export function TarjetaCatalogoPublica({
  item,
  mostrarEmpresa = false,
  oferta = null,
}: {
  item: ItemPublicoResumen
  mostrarEmpresa?: boolean
  /** La mejor oferta viva sobre este ítem (ver `modules/comercio/vitrina`). */
  oferta?: OfertaPublica | null
}) {
  // Una oferta de Membego (ítem puente) se compra en SU página: el checkout es el de Supply.
  const esSupply = item.origen === 'SUPPLY' && !!item.ofertaSlug
  const href = esSupply ? `${RUTA_OFERTAS_MEMBEGO}/${item.ofertaSlug}` : `/empresas/${item.company.slug}/catalogo/${item.slug}`
  const agotado = item.disponibilidad === 'AGOTADO'
  const pct = oferta ? porcentajeDeAhorro(oferta) : null
  const servicio = esServicio(item)
  return (
    <Link
      href={href}
      className="group flex flex-col overflow-hidden rounded-lg border border-border bg-card elevation-1 transition-colors duration-fast hover:border-primary/40"
      aria-label={`${item.name}${mostrarEmpresa ? ` · ${item.company.name}` : ''}`}
    >
      <div className="relative aspect-[16/10] bg-muted">
        {item.imageUrl ? (
          <Image
            src={item.imageUrl}
            alt={item.name}
            fill
            className={`object-cover transition group-hover:scale-105 ${agotado ? 'opacity-60' : ''}`}
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Package className="h-10 w-10 text-muted-foreground/30" aria-hidden />
          </div>
        )}
        {oferta && !agotado && (
          <span className="absolute left-3 top-3 rounded-full bg-primary px-2.5 py-0.5 text-label-sm font-semibold text-primary-foreground">
            {pct ? `${pct}% OFF` : oferta.etiqueta}
          </span>
        )}
        {esSupply && (
          <span className="absolute left-3 top-3 rounded-full bg-card/95 px-2.5 py-0.5 text-label-sm font-semibold text-primary">Oferta MembeGo</span>
        )}
        {agotado && (
          <span className="absolute right-3 top-3 rounded-full bg-foreground/80 px-2.5 py-0.5 text-label-sm font-semibold text-white">Agotado</span>
        )}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <h3 className="text-label-lg text-foreground">{item.name}</h3>
        {mostrarEmpresa && !esSupply && <p className="mt-0.5 text-caption text-muted-foreground">{item.company.name}</p>}
        {oferta && !agotado ? (
          <p className="mt-2 flex flex-wrap items-baseline gap-x-2 tabular-nums">
            <span className="text-caption text-muted-foreground">
              Antes <span className="line-through">{formatearPrecio(oferta.precioAntes, oferta.currency)}</span>
            </span>
            <span className="text-price-sm text-foreground">
              <span className="mr-1 text-caption font-normal text-muted-foreground">Ahora</span>
              {formatearPrecio(oferta.precioAhora, oferta.currency)}
            </span>
          </p>
        ) : item.priceFrom != null ? (
          <p className="mt-2 text-price-sm tabular-nums text-foreground">
            {item.hasVariants && <span className="mr-1 font-normal text-muted-foreground">Desde</span>}
            {formatearPrecio(item.priceFrom, item.currency)}
          </p>
        ) : null}
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted-foreground">
          <span className={agotado ? 'text-muted-foreground' : item.disponibilidad === 'POCAS_UNIDADES' ? 'font-medium text-warning' : 'font-medium text-success'}>
            {ETIQUETA_DISPONIBILIDAD[item.disponibilidad]}
          </span>
          {!esSupply && <span aria-hidden>·</span>}
          {!esSupply && <span>{servicio ? 'Servicio' : 'Para recoger'}</span>}
        </p>
        <span className="mt-auto pt-3 text-label-md font-semibold text-primary">{ctaDelItem(item, !!oferta)} →</span>
      </div>
    </Link>
  )
}
