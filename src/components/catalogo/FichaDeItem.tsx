import type { ReactNode } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { ArrowLeft, MapPin, Package, Sparkles } from 'lucide-react'
import { formatearPrecio, ETIQUETA_TIPO } from '@/modules/catalog/formato'
import { ETIQUETA_DISPONIBILIDAD } from '@/modules/catalog/publico-nucleo'
import { rutaDeEmpresa, type Espacio } from '@/modules/comercio/rutas'
import type { FichaDeItemDatos } from '@/modules/comercio/ficha-item'

/**
 * LA FICHA DE UN PRODUCTO O SERVICIO — SOLO PRESENTACIÓN.
 *
 * Galería, nombre, empresa, precio normal y promocional (si hay una oferta VIVA
 * sobre el ítem: la oferta REFERENCIA al producto, nunca es una copia), ahorro,
 * descripción, variantes/opciones, sucursal, disponibilidad («Disponible» /
 * «Pocas unidades» / «Agotado»: nunca la cantidad) y condiciones de la oferta.
 *
 * NO opera. Lo que sí opera —obtener la oferta, agregar al carrito, pedir,
 * reservar— entra por dos RANURAS que llena quien monta la ficha:
 *
 *   · la app del cliente (`/cliente/...`) pone ahí los formularios y botones;
 *   · la landing pone el traspaso a la app (`TraspasoALaApp`).
 *
 * Por eso este componente puede usarse en los dos espacios sin que la landing
 * arrastre ninguna operación comercial: no importa ni una.
 */
export function FichaDeItem({
  ficha,
  espacio,
  ranuraOferta,
  ranuraCompra,
}: {
  ficha: FichaDeItemDatos
  espacio: Espacio
  /** El botón de «Obtener oferta» (app) o el traspaso (landing). Solo se pinta si hay oferta viva. */
  ranuraOferta: ReactNode
  /** Agregar al carrito + pedir/reservar (app) o el traspaso (landing). Solo se pinta si la empresa recibe pedidos. */
  ranuraCompra: ReactNode
}) {
  const { item, hrefOferta, pedido, ofertas, mejorOferta, pct, agotado, servicio } = ficha

  return (
    <div>
      <Link href={`${rutaDeEmpresa(espacio, item.company.slug)}#${servicio ? 'servicios' : 'catalogo'}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
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
              <Link href={rutaDeEmpresa(espacio, item.company.slug)} className="underline">
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
              <div className="mt-3">{ranuraOferta}</div>
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
              {ranuraCompra}
            </div>
          )}

          {hrefOferta ? (
            <Link href={hrefOferta} className="mt-6 inline-flex h-10 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground">
              Ver la oferta y comprar
            </Link>
          ) : (
            <Link
              href={rutaDeEmpresa(espacio, item.company.slug)}
              className="mt-6 inline-flex h-10 items-center rounded-lg border border-border px-5 text-sm font-medium text-foreground hover:bg-muted"
            >
              Ver {item.company.name}
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
