import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { ArrowLeft, MapPin, Package, Sparkles } from 'lucide-react'
import { getItemCatalogoPublico } from '@/modules/marketplace/cached'
import { formatearPrecio } from '@/modules/catalog/formato'
import { ETIQUETA_TIPO } from '@/modules/catalog/formato'
import { SITE_NAME } from '@/lib/site'
import { shareMetadata } from '@/lib/share/metadata'
import { ETIQUETA_DISPONIBILIDAD, RUTA_OFERTAS_MEMBEGO } from '@/modules/catalog/publico-nucleo'
import { opcionesDePedidoPublico } from '@/modules/orders/publico'
import { ofertasPublicas } from '@/modules/deals/publico'
import { esServicio, porcentajeDeAhorro } from '@/modules/comercio/vitrina'
import { PedirForm } from '@/components/pedidos/PedirForm'
import { AgregarAlCarrito } from '@/components/checkout/AgregarAlCarrito'
import { ReclamarOfertaBoton } from '@/components/deals/ReclamarOfertaBoton'

interface Props {
  params: Promise<{ companySlug: string; itemSlug: string }>
}

export const revalidate = 120

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { companySlug, itemSlug } = await params
  const item = await getItemCatalogoPublico(companySlug, itemSlug)
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
 *
 * Lo que enseña, según el caso: galería, nombre, empresa, precio normal y
 * promocional (si hay una oferta VIVA sobre el ítem: la oferta REFERENCIA al
 * producto, nunca es una copia), ahorro, descripción, variantes/opciones,
 * sucursal, disponibilidad («Disponible» / «Pocas unidades» / «Agotado»: nunca
 * la cantidad), condiciones de la oferta, y el botón que corresponde:
 * «Obtener oferta», «Agregar al carrito» / «Pedir», «Reservar» (servicio) o
 * «Ver la oferta Membego» (Supply).
 */
export default async function ItemCatalogoPublicoPage({ params }: Props) {
  const { companySlug, itemSlug } = await params
  const item = await getItemCatalogoPublico(companySlug, itemSlug)
  if (!item) notFound()
  const hrefOferta = item.origen === 'SUPPLY' && item.ofertaSlug ? `${RUTA_OFERTAS_MEMBEGO}/${item.ofertaSlug}` : null
  // Pedir es de los productos de la EMPRESA: las ofertas de Membego se compran por su propio checkout.
  const pedido = item.origen === 'EMPRESA' ? await opcionesDePedidoPublico(item.company.slug) : null
  const ofertasDeLaEmpresa = item.origen === 'EMPRESA' ? await ofertasPublicas({ companySlug: item.company.slug, limite: 24 }).catch(() => []) : []
  // Las ofertas VIVAS sobre este ítem (sus variantes). Si hay varias, la de menor precio va primero.
  const ofertas = ofertasDeLaEmpresa.filter((o) => o.itemSlug === item.slug).sort((a, b) => Number(a.precioAhora) - Number(b.precioAhora))
  const mejorOferta = ofertas[0] ?? null
  const pct = mejorOferta ? porcentajeDeAhorro(mejorOferta) : null
  const agotado = item.disponibilidad === 'AGOTADO'
  const servicio = esServicio(item)
  const retorno = `/empresas/${item.company.slug}/catalogo/${item.slug}`

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <Link href={`/empresas/${item.company.slug}#${servicio ? 'servicios' : 'catalogo'}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
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
            {mejorOferta && !agotado && (
              <span className="absolute left-4 top-4 rounded-full bg-primary px-3 py-1 text-sm font-semibold text-primary-foreground">{pct ? `${pct}% OFF` : mejorOferta.etiqueta}</span>
            )}
            {agotado && <span className="absolute right-4 top-4 rounded-full bg-foreground/80 px-3 py-1 text-sm font-semibold text-white">Agotado</span>}
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

          {/* Precio: normal, o «antes / ahora / ahorras» cuando hay una oferta viva. */}
          <div className="mt-4" aria-label="Precio">
            {mejorOferta && !agotado ? (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
                <p className="text-caption text-muted-foreground">
                  Antes <span className="line-through tabular-nums">{formatearPrecio(mejorOferta.precioAntes, mejorOferta.currency)}</span>
                </p>
                <p className="mt-0.5 flex flex-wrap items-baseline gap-2">
                  <span className="text-caption text-muted-foreground">Ahora</span>
                  <span className="text-price-lg tabular-nums text-foreground">{formatearPrecio(mejorOferta.precioAhora, mejorOferta.currency)}</span>
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-caption font-semibold text-primary">Ahorras {formatearPrecio(mejorOferta.ahorro, mejorOferta.currency)}</span>
                </p>
                {ofertas.length > 1 && <p className="mt-1 text-caption text-muted-foreground">Hay {ofertas.length} ofertas sobre este ítem; esta es la mejor.</p>}
              </div>
            ) : item.priceFrom != null ? (
              <p className="text-price-lg tabular-nums text-foreground">
                {item.hasVariants && <span className="mr-1 text-caption font-normal text-muted-foreground">Desde</span>}
                {formatearPrecio(item.priceFrom, item.currency)}
              </p>
            ) : null}
            <p className="mt-2 text-sm">
              <span className={agotado ? 'text-muted-foreground' : item.disponibilidad === 'POCAS_UNIDADES' ? 'font-medium text-warning' : 'font-medium text-success'}>
                {ETIQUETA_DISPONIBILIDAD[item.disponibilidad]}
              </span>
              {!hrefOferta && <span className="text-muted-foreground"> · {servicio ? 'Servicio: se presta en la sucursal' : 'Producto: se recoge en la sucursal con tu QR'}</span>}
            </p>
          </div>

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

          {/* La oferta viva sobre el ítem: condiciones y «Obtener oferta». Es la misma entidad que ve la empresa en /admin/deals. */}
          {mejorOferta && !agotado && (
            <section className="mt-8 rounded-lg border border-border p-4" aria-label="Oferta activa">
              <h2 className="flex items-center gap-2 text-h3 text-foreground">
                <Sparkles className="h-4 w-4 text-primary" aria-hidden />
                {mejorOferta.title}
              </h2>
              {mejorOferta.description && <p className="mt-1 text-sm text-muted-foreground">{mejorOferta.description}</p>}
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                <li>Obtienes un cupón con QR por {mejorOferta.variantName !== mejorOferta.itemName ? `«${mejorOferta.variantName}» ` : ''}una unidad a {formatearPrecio(mejorOferta.precioAhora, mejorOferta.currency)}, y lo canjeas en el negocio.</li>
                <li>El cupón vale {mejorOferta.voucherDays} días desde que lo obtienes.</li>
                {mejorOferta.endsAt && <li>Oferta vigente hasta el {new Date(mejorOferta.endsAt).toLocaleDateString('es-DO', { day: 'numeric', month: 'long', timeZone: 'America/Santo_Domingo' })}.</li>}
                {mejorOferta.soloClientesNuevos && <li>Solo para quienes aún no han visitado este negocio.</li>}
                {mejorOferta.quedan !== null && <li className="font-medium text-foreground">{mejorOferta.quedan === 1 ? 'Queda 1' : `Quedan ${mejorOferta.quedan}`}</li>}
              </ul>
              <div className="mt-3">
                <ReclamarOfertaBoton dealId={mejorOferta.id} retorno={retorno} sucursales={mejorOferta.sucursales} />
              </div>
            </section>
          )}

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
                  <p className={`text-caption ${v.disponibilidad === 'AGOTADO' ? 'text-muted-foreground' : v.disponibilidad === 'POCAS_UNIDADES' ? 'text-warning' : 'text-success'}`}>
                    {ETIQUETA_DISPONIBILIDAD[v.disponibilidad]}
                  </p>
                </div>
              </li>
            ))}
          </ul>

          {pedido?.habilitado && (
            <div className="mt-6 space-y-4">
              {pedido.sucursales.length > 0 && (
                <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span>
                    {servicio ? 'Se atiende en' : 'Se recoge en'}: {pedido.sucursales.map((s) => s.nombre).join(' · ')}
                  </span>
                </p>
              )}
              {/* El carrito admite productos Y servicios en un mismo pedido (una instalación con su cable);
                  lo que cambia según el tipo es el botón principal de abajo: «Hacer un pedido» o «Reservar». */}
              <AgregarAlCarrito
                companySlug={item.company.slug}
                moneda={item.currency}
                conVariantes={item.hasVariants}
                variantes={item.variants.map((v) => ({ id: v.id, name: v.name, price: v.price, available: v.available }))}
              />
              <PedirForm
                retorno={retorno}
                moneda={item.currency}
                conVariantes={item.hasVariants}
                variantes={item.variants.map((v) => ({ id: v.id, name: v.name, price: v.price, available: v.available, sucursalesConStock: v.sucursalesConStock, disponibilidad: v.disponibilidad }))}
                sucursales={pedido.sucursales}
                titulo={servicio ? 'Reservar este servicio' : 'Hacer un pedido'}
                cta={servicio ? 'Reservar' : 'Enviar pedido'}
              />
            </div>
          )}

          {hrefOferta ? (
            <Link href={hrefOferta} className="mt-6 inline-flex h-10 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground">
              Ver la oferta y comprar
            </Link>
          ) : (
            <Link
              href={`/empresas/${item.company.slug}`}
              className="mt-6 inline-flex h-10 items-center rounded-lg border border-border px-5 text-sm font-medium text-foreground hover:bg-muted"
            >
              Ver {item.company.name}
            </Link>
          )}
        </div>
      </div>
    </main>
  )
}
