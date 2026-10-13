import Link from 'next/link'
import Image from 'next/image'
import { Package } from 'lucide-react'
import { formatearPrecio } from '@/modules/catalog/formato'
import { ETIQUETA_DISPONIBILIDAD, type ItemPublicoResumen } from '@/modules/catalog/publico-nucleo'
import type { OfertaPublica } from '@/modules/deals/publico-nucleo'
import { ctaDelItem, esServicio, porcentajeDeAhorro } from '@/modules/comercio/vitrina'
import { rutaDeItem, rutaDeOfertaMembego, type Espacio } from '@/modules/comercio/rutas'

/**
 * Tarjeta pública de un ítem del catálogo: la usan la vitrina de la empresa, el
 * descubrimiento entre empresas y el inicio. Componente de servidor, sin estado.
 *
 * Es COMPACTA a propósito, al estilo de un marketplace: pensada para pintarse de
 * a dos por fila en el móvil (≈170 px de ancho), con la foto cuadrada del formato
 * del catálogo, el nombre en dos líneas como máximo y el precio como lo que más
 * pesa. Toda la tarjeta es el enlace, así que no lleva un botón aparte: la acción
 * («Reservar», «Obtener oferta»…) se dice en una línea corta al pie.
 *
 * Enseña, según aplique: imagen, nombre, empresa, precio, precio anterior,
 * % de descuento y distintivo de oferta (si hay una oferta VIVA sobre el ítem),
 * disponibilidad («Disponible» / «Pocas unidades» / «Agotado», nunca la
 * cantidad), y si es servicio o producto para recoger.
 * No recibe nada interno: solo proyecciones públicas.
 */
export function TarjetaCatalogoPublica({
  item,
  espacio,
  mostrarEmpresa = false,
  oferta = null,
}: {
  item: ItemPublicoResumen
  /** Dónde se pinta: de él sale la ficha a la que lleva (la de la landing o la de la app). Obligatorio. */
  espacio: Espacio
  mostrarEmpresa?: boolean
  /** La mejor oferta viva sobre este ítem (ver `modules/comercio/vitrina`). */
  oferta?: OfertaPublica | null
}) {
  // Una oferta de Membego (ítem puente) tiene SU ficha: el checkout es el de Supply, y se compra dentro de la app.
  const esSupply = item.origen === 'SUPPLY' && !!item.ofertaSlug
  const href = esSupply ? rutaDeOfertaMembego(espacio, item.ofertaSlug!) : rutaDeItem(espacio, item.company.slug, item.slug)
  const agotado = item.disponibilidad === 'AGOTADO'
  const pct = oferta ? porcentajeDeAhorro(oferta) : null
  const servicio = esServicio(item)
  return (
    <Link
      href={href}
      className="group flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card elevation-1 transition-colors duration-fast hover:border-primary/40"
      aria-label={`${item.name}${mostrarEmpresa ? ` · ${item.company.name}` : ''}`}
    >
      <div className="relative aspect-square bg-muted">
        {item.imageUrl ? (
          <Image
            src={item.imageUrl}
            alt={item.name}
            fill
            className={`object-cover transition group-hover:scale-105 ${agotado ? 'opacity-60' : ''}`}
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Package className="h-8 w-8 text-muted-foreground/30" aria-hidden />
          </div>
        )}
        {oferta && !agotado && (
          <span className="absolute left-2 top-2 rounded-full bg-primary px-2 py-0.5 text-label-sm font-semibold text-primary-foreground">
            {pct ? `${pct}% OFF` : oferta.etiqueta}
          </span>
        )}
        {esSupply && (
          <span className="absolute left-2 top-2 rounded-full bg-card/95 px-2 py-0.5 text-label-sm font-semibold text-primary">Oferta MembeGo</span>
        )}
        {agotado && (
          <span className="absolute right-2 top-2 rounded-full bg-foreground/80 px-2 py-0.5 text-label-sm font-semibold text-white">Agotado</span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-0.5 p-2.5 sm:p-3">
        <h3 className="line-clamp-2 text-label-lg text-foreground">{item.name}</h3>
        {mostrarEmpresa && !esSupply && <p className="truncate text-caption text-muted-foreground">{item.company.name}</p>}
        {oferta && !agotado ? (
          <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5 tabular-nums">
            <span className="text-price-sm text-foreground">
              <span className="sr-only">Ahora </span>
              {formatearPrecio(oferta.precioAhora, oferta.currency)}
            </span>
            <span className="text-caption text-muted-foreground line-through">
              <span className="sr-only">Antes </span>
              {formatearPrecio(oferta.precioAntes, oferta.currency)}
            </span>
          </p>
        ) : item.priceFrom != null ? (
          <p className="mt-1 text-price-sm tabular-nums text-foreground">
            {item.hasVariants && <span className="mr-1 font-normal text-muted-foreground">Desde</span>}
            {formatearPrecio(item.priceFrom, item.currency)}
          </p>
        ) : null}
        <p className="truncate text-caption text-muted-foreground">
          <span className={agotado ? 'text-muted-foreground' : item.disponibilidad === 'POCAS_UNIDADES' ? 'font-medium text-warning' : 'font-medium text-success'}>
            {ETIQUETA_DISPONIBILIDAD[item.disponibilidad]}
          </span>
          {!esSupply && <span aria-hidden> · </span>}
          {!esSupply && <span>{servicio ? 'Servicio' : 'Para recoger'}</span>}
        </p>
        <span className="mt-auto truncate pt-1.5 text-label-md font-semibold text-primary">{ctaDelItem(item, !!oferta)} →</span>
      </div>
    </Link>
  )
}
