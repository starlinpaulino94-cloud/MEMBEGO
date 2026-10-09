import Link from 'next/link'
import { BadgePercent, ChevronRight, ShoppingBag } from 'lucide-react'
import type { ItemPublicoResumen } from '@/modules/catalog/publico-nucleo'
import type { OfertaPublica } from '@/modules/deals/publico-nucleo'
import { TarjetaCatalogoPublica } from '@/components/catalogo/TarjetaCatalogoPublica'
import { TarjetaOferta } from '@/components/deals/TarjetaOferta'
import { RailOverflowHint } from '@/components/ui/RailOverflowHint'
import { claveDeItem, indiceDeOfertas } from '@/modules/comercio/vitrina'

/**
 * INICIO DEL CLIENTE · las dos bandas del comercio: «Ofertas destacadas» (las
 * ofertas vivas sobre el catálogo, con antes/ahora) y «Nuevo en Membego» (lo
 * último que publicaron los negocios). Son los MISMOS datos y las MISMAS
 * tarjetas que /cliente/explorar, /catalogo y la vitrina de cada empresa: nada
 * se recalcula aquí y ninguna empresa está escrita a mano.
 *
 * Sin contenido, la banda no se pinta: un inicio no enseña secciones vacías.
 */
export function VibeComercio({ ofertas, productos }: { ofertas: readonly OfertaPublica[]; productos: readonly ItemPublicoResumen[] }) {
  if (ofertas.length === 0 && productos.length === 0) return null
  const ofertaPorItem = indiceDeOfertas(ofertas)
  return (
    <>
      {ofertas.length > 0 && (
        <section className="mt-6 px-4" aria-labelledby="vibe-ofertas-title">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <BadgePercent className="size-5 text-vibe-violet" aria-hidden />
              <h3 id="vibe-ofertas-title" className="text-h2 text-foreground">
                Ofertas destacadas
              </h3>
            </div>
            <Link href="/cliente/explorar?ver=ofertas" className="flex items-center gap-0.5 text-label-sm font-bold text-vibe-violet hover:underline">
              <span>Ver todas</span>
              <ChevronRight className="size-4" />
            </Link>
          </div>
          <RailOverflowHint className="from-vibe-fondo via-vibe-fondo/90 to-transparent text-vibe-violet">
            <div className="flex gap-3 overflow-x-auto pb-2 pr-10 scrollbar-none">
              {ofertas.map((o) => (
                <div key={o.id} className="w-72 shrink-0 sm:w-80">
                  <TarjetaOferta oferta={o} retorno="/cliente/inicio" espacio="app" />
                </div>
              ))}
            </div>
          </RailOverflowHint>
        </section>
      )}

      {productos.length > 0 && (
        <section className="mt-6 px-4" aria-labelledby="vibe-productos-title">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ShoppingBag className="size-5 text-vibe-violet" aria-hidden />
              <h3 id="vibe-productos-title" className="text-h2 text-foreground">
                Nuevo en Membego
              </h3>
            </div>
            <Link href="/cliente/explorar?ver=productos" className="flex items-center gap-0.5 text-label-sm font-bold text-vibe-violet hover:underline">
              <span>Ver más</span>
              <ChevronRight className="size-4" />
            </Link>
          </div>
          <RailOverflowHint className="from-vibe-fondo via-vibe-fondo/90 to-transparent text-vibe-violet">
            <div className="flex gap-3 overflow-x-auto pb-2 pr-10 scrollbar-none">
              {productos.map((item) => (
                <div key={item.id} className="w-56 shrink-0 sm:w-64">
                  <TarjetaCatalogoPublica item={item} mostrarEmpresa oferta={ofertaPorItem.get(claveDeItem(item)) ?? null} />
                </div>
              ))}
            </div>
          </RailOverflowHint>
        </section>
      )}
    </>
  )
}
