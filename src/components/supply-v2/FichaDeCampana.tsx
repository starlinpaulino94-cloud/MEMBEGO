import Link from 'next/link'
import { CalendarClock, Clock, Store, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RUTA_CUPONES_CLIENTE } from '@/modules/supply-v2/core/catalogo'
import type { campanaPublicaPorCodigo } from '@/modules/supply-v2/campaigns/queries'
import { rutaDeCampanas, rutaDeOfertaMembego, type Espacio } from '@/modules/comercio/rutas'

type Campana = NonNullable<Awaited<ReturnType<typeof campanaPublicaPorCodigo>>>

function dinero(n: string, moneda: string): string {
  return `${moneda === 'DOP' ? 'RD$' : `${moneda} `}${Number(n).toLocaleString('es-DO', { minimumFractionDigits: 0 })}`
}

/**
 * MEMBEGO SUPPLY · SLICE 7 · ficha de una CAMPAÑA (§19), UNA sola vez para los dos espacios.
 *
 * Nombre, qué es, hasta cuándo vale, qué empresas participan, qué productos y en qué condiciones. Desde aquí se
 * elige una oferta y se compra en su ficha de siempre —la de la app—: la campaña no es otro checkout. Las
 * ofertas enlazan a la ficha de SU espacio; «Mis cupones» es del cliente y solo la app lo muestra.
 */
export function FichaDeCampana({ c, espacio }: { c: Campana; espacio: Espacio }) {
  return (
    <main className="container max-w-3xl py-10">
      <p className="mb-3 text-caption">
        <Link href={rutaDeCampanas(espacio)} className="text-muted-foreground underline-offset-4 hover:underline">← Campañas</Link>
      </p>
      <div className="rounded-2xl border border-border/70 bg-card p-6 shadow-premium">
        <h1 className="text-h1" data-testid="campana-ficha-nombre">{c.name}</h1>
        <p className="mt-1 font-mono text-caption text-muted-foreground">{c.code}</p>
        {c.description && <p className="mt-3 text-body">{c.description}</p>}

        <ul className="mt-4 space-y-1 text-sm text-muted-foreground">
          <li className="flex items-center gap-2"><Store className="h-4 w-4" aria-hidden /> {c.empresas.join(' · ')}</li>
          {c.endsAt && (
            <li className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4" aria-hidden /> Válida hasta {new Intl.DateTimeFormat('es-DO', { dateStyle: 'medium' }).format(new Date(c.endsAt))}
            </li>
          )}
          {c.horario && <li className="flex items-center gap-2"><Clock className="h-4 w-4" aria-hidden /> Solo de {c.horario}</li>}
          {c.paraTi === false && <li className="flex items-center gap-2 text-warning"><Users className="h-4 w-4" aria-hidden /> Esta campaña es para otro grupo de clientes.</li>}
        </ul>

        <h2 className="mt-6 text-h3">Productos que participan</h2>
        <ul className="mt-2 space-y-2" data-testid="campana-ficha-ofertas">
          {c.ofertas.map((o) => (
            <li key={o.slug} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3">
              <span>
                <Link href={rutaDeOfertaMembego(espacio, o.slug)} className="font-medium underline-offset-4 hover:underline" data-testid="campana-ficha-oferta">{o.titulo}</Link>
                <span className="block text-caption text-muted-foreground">{o.proveedor} · {o.producto}</span>
                {o.exigeCupon && <span className="mt-1 inline-block rounded-full border border-border px-2 py-0.5 text-caption text-muted-foreground">Pide su código en el checkout</span>}
              </span>
              <span className="text-right">
                <span className="block tabular-nums">{dinero(o.salePrice, o.currency)}</span>
                {o.rebaja && <span className="block text-caption font-semibold text-success">−{o.rebaja}</span>}
                <Button asChild size="sm" className="mt-1">
                  <Link href={rutaDeOfertaMembego(espacio, o.slug)}>{espacio === 'app' ? 'Ver y comprar' : 'Ver oferta'}</Link>
                </Button>
              </span>
            </li>
          ))}
        </ul>

        <h2 className="mt-6 text-h3">Condiciones</h2>
        <ul className="mt-2 space-y-0.5 text-sm text-muted-foreground" data-testid="campana-ficha-condiciones">
          {c.condiciones.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>

        {espacio === 'app' && (
          <Button asChild variant="outline" className="mt-5">
            <Link href={RUTA_CUPONES_CLIENTE}>Ver mis cupones</Link>
          </Button>
        )}
      </div>
    </main>
  )
}
