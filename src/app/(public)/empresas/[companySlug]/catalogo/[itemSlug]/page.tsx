import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { ArrowLeft, Package } from 'lucide-react'
import { itemCatalogoPublico } from '@/modules/catalog/publico'
import { formatearPrecio } from '@/modules/catalog/formato'
import { ETIQUETA_TIPO } from '@/modules/catalog/formato'
import { SITE_NAME } from '@/lib/site'
import { shareMetadata } from '@/lib/share/metadata'
import { RUTA_OFERTAS_PUBLICAS } from '@/modules/supply-v2/core/catalogo'

interface Props {
  params: Promise<{ companySlug: string; itemSlug: string }>
}

export const revalidate = 120

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { companySlug, itemSlug } = await params
  const item = await itemCatalogoPublico(companySlug, itemSlug)
  if (!item) return { title: `Producto · ${SITE_NAME}` }
  return shareMetadata({
    title: `${item.name} · ${item.company.name}`,
    description: item.description ?? `${item.name}, de ${item.company.name}.`,
    url: `/empresas/${item.company.slug}/catalogo/${item.slug}`,
    image: item.imageUrl ?? undefined,
  })
}

/**
 * Detalle público de un ítem. «No existe» y «no es público» (borrador,
 * pausado, otra empresa sin la capacidad…) se ven EXACTAMENTE igual: no se
 * puede averiguar desde fuera qué hay en un catálogo que no se publicó.
 */
export default async function ItemCatalogoPublicoPage({ params }: Props) {
  const { companySlug, itemSlug } = await params
  const item = await itemCatalogoPublico(companySlug, itemSlug)
  if (!item) notFound()
  const hrefOferta = item.origen === 'SUPPLY' && item.ofertaSlug ? `${RUTA_OFERTAS_PUBLICAS}/${item.ofertaSlug}` : null

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <Link
        href={`/empresas/${item.company.slug}#catalogo`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {item.company.name}
      </Link>

      <div className="mt-6 grid gap-8 md:grid-cols-2">
        <div className="space-y-3">
          <div className="relative aspect-square overflow-hidden rounded-lg border border-border bg-muted">
            {item.images[0] ? (
              <Image src={item.images[0]} alt={item.name} fill className="object-cover" sizes="(max-width: 768px) 100vw, 50vw" priority />
            ) : (
              <div className="flex h-full items-center justify-center">
                <Package className="h-14 w-14 text-muted-foreground/30" aria-hidden />
              </div>
            )}
          </div>
          {item.images.length > 1 && (
            <ul className="grid grid-cols-4 gap-2">
              {item.images.slice(1, 9).map((u) => (
                <li key={u} className="relative aspect-square overflow-hidden rounded-lg border border-border bg-muted">
                  <Image src={u} alt="" fill className="object-cover" sizes="120px" />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="text-caption text-muted-foreground">{ETIQUETA_TIPO[item.type]}</p>
          <h1 className="mt-1 text-h1 text-foreground">{item.name}</h1>
          {hrefOferta ? (
            <p className="mt-1 inline-block rounded-full bg-primary/10 px-2.5 py-0.5 text-caption font-medium text-primary">Oferta MembeGo</p>
          ) : (
            <p className="mt-1 text-muted-foreground">
              de{' '}
              <Link href={`/empresas/${item.company.slug}`} className="underline">
                {item.company.name}
              </Link>
            </p>
          )}

          {item.categories.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {item.categories.map((c) => (
                <li key={c.slug} className="rounded-full border border-border px-2.5 py-0.5 text-caption">
                  {c.name}
                </li>
              ))}
            </ul>
          )}

          {item.description && <p className="mt-5 whitespace-pre-line text-foreground">{item.description}</p>}

          <h2 className="mt-8 text-h3 text-foreground">{item.hasVariants ? 'Opciones' : 'Precio'}</h2>
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
            {item.variants.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  {item.hasVariants && <p className="font-medium text-foreground">{v.name}</p>}
                  {/* Los atributos solo se repiten si dicen algo que el nombre no dice. */}
                  {Object.keys(v.attributes).length > 0 && Object.values(v.attributes).join(' · ') !== v.name && (
                    <p className="text-caption text-muted-foreground">{Object.values(v.attributes).join(' · ')}</p>
                  )}
                </div>
                <div className="text-right">
                  {v.compareAtPrice && (
                    <span className="mr-2 text-caption text-muted-foreground line-through tabular-nums">
                      {formatearPrecio(v.compareAtPrice, item.currency)}
                    </span>
                  )}
                  <span className="text-price-sm font-semibold tabular-nums text-foreground">{formatearPrecio(v.price, item.currency)}</span>
                  {!v.available && <p className="text-caption text-muted-foreground">Agotado</p>}
                </div>
              </li>
            ))}
          </ul>

          {hrefOferta ? (
            <Link href={hrefOferta} className="mt-6 inline-flex h-10 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground">
              Ver la oferta y comprar
            </Link>
          ) : (
            <Link
              href={`/empresas/${item.company.slug}`}
              className="mt-6 inline-flex h-10 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground"
            >
              Ver {item.company.name}
            </Link>
          )}
        </div>
      </div>
    </main>
  )
}
