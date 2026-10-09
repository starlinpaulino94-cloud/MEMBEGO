'use client'

import { rutaDeEmpresa, rutaDePago } from '@/modules/comercio/rutas'
import Link from 'next/link'
import { Loader2, Minus, Plus, ShoppingCart, Trash2 } from 'lucide-react'
import { MAX_CANTIDAD_POR_LINEA, type LineaDeCarrito } from '@/modules/checkout/domain'
import { formatearMonto } from '@/modules/orders/formato'
import { Button } from '@/components/ui/button'
import { useCarrito } from './useCarrito'
import { useResumen } from './useResumen'

/** Un negocio dentro del carrito: sus renglones con precios de hoy y el paso al pago. */
function CarritoDelNegocio({ slug, lineas }: { slug: string; lineas: LineaDeCarrito[] }) {
  const { fijar, quitar, vaciar } = useCarrito()
  const r = useResumen(slug, lineas, null)

  if (r.estado === 'cargando') {
    return (
      <section className="rounded-lg border border-border p-4" aria-busy>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Cargando tu carrito…
        </p>
      </section>
    )
  }
  if (r.estado === 'error') {
    return (
      <section className="space-y-3 rounded-lg border border-border p-4" data-testid={`carrito-${slug}`}>
        <p className="text-sm text-destructive" role="alert">
          {r.error}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => vaciar(slug)}>
          Quitar este negocio del carrito
        </Button>
      </section>
    )
  }

  const { empresa, resumen } = r
  return (
    <section className="rounded-lg border border-border" data-testid={`carrito-${slug}`} aria-label={`Carrito de ${empresa.nombre}`}>
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="text-h3 text-foreground">
          <Link href={rutaDeEmpresa('app', empresa.slug)} className="hover:underline">
            {empresa.nombre}
          </Link>
        </h2>
        <button type="button" onClick={() => vaciar(slug)} className="text-sm text-muted-foreground underline hover:text-foreground">
          Vaciar
        </button>
      </header>
      <ul className="divide-y divide-border">
        {resumen.renglones.map((l) => (
          <li key={l.varianteId} className="space-y-2 px-4 py-3" data-testid="carrito-renglon">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium text-foreground">{l.nombre}</p>
                <p className="text-sm text-muted-foreground tabular-nums">{formatearMonto(l.precio, resumen.moneda)} c/u</p>
                {l.problema && (
                  <p className="mt-1 text-sm font-medium text-destructive" role="alert">
                    {l.problema}
                  </p>
                )}
              </div>
              <p className="tabular-nums text-foreground">{l.problema ? '—' : formatearMonto(l.subtotal, resumen.moneda)}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="icon-sm" aria-label={`Una menos de ${l.nombre}`} disabled={l.cantidad <= 1} onClick={() => fijar(slug, l.varianteId, l.cantidad - 1)}>
                <Minus className="h-3.5 w-3.5" aria-hidden />
              </Button>
              <span className="w-8 text-center text-sm tabular-nums" aria-label={`Cantidad de ${l.nombre}`}>
                {l.cantidad}
              </span>
              <Button type="button" variant="outline" size="icon-sm" aria-label={`Una más de ${l.nombre}`} disabled={l.cantidad >= MAX_CANTIDAD_POR_LINEA} onClick={() => fijar(slug, l.varianteId, l.cantidad + 1)}>
                <Plus className="h-3.5 w-3.5" aria-hidden />
              </Button>
              <Button type="button" variant="ghost" size="sm" className="ml-auto text-muted-foreground" onClick={() => quitar(slug, l.varianteId)}>
                <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                Quitar
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
        <p className="text-sm text-muted-foreground">
          Total <span className="text-lg font-semibold text-foreground tabular-nums">{formatearMonto(resumen.total, resumen.moneda)}</span>
        </p>
        <Button asChild>
          <Link href={rutaDePago(empresa.slug)}>Continuar al pago</Link>
        </Button>
      </footer>
    </section>
  )
}

/** /carrito — un bloque por negocio: cada negocio atiende (y se paga) por separado. */
export function CarritoVista() {
  const { carrito } = useCarrito()
  const negocios = Object.entries(carrito.negocios)

  if (negocios.length === 0) {
    return (
      <div className="mt-10 rounded-lg border border-border py-16 text-center text-muted-foreground">
        <ShoppingCart className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" aria-hidden />
        <p className="font-medium">Tu carrito está vacío</p>
        <p className="text-sm">Agrega productos desde la ficha de cualquier negocio.</p>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/cliente/explorar">Ver negocios</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="mt-6 space-y-5">
      {negocios.length > 1 && <p className="rounded-lg bg-muted/50 px-4 py-3 text-sm text-muted-foreground">Cada negocio atiende su propio pedido: pagas y recoges en cada uno por separado.</p>}
      {negocios.map(([slug, lineas]) => (
        <CarritoDelNegocio key={slug} slug={slug} lineas={lineas} />
      ))}
    </div>
  )
}
