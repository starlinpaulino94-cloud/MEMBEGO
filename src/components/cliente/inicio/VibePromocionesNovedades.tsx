'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Sparkles, Clock, Tag, Flame, ArrowRight } from 'lucide-react'
import type { PromocionesNovedadesVista, PromoNovedadItem } from '@/modules/home/vista'
import { RailOverflowHint } from '@/components/ui/RailOverflowHint'

type TabKey = 'paraTi' | 'exclusivas' | 'descuentos' | 'porVencer'

const TABS: { key: TabKey; label: string; icon: typeof Sparkles }[] = [
  { key: 'paraTi', label: 'Para ti', icon: Sparkles },
  { key: 'exclusivas', label: 'Exclusivas miembros', icon: Tag },
  { key: 'descuentos', label: '2x1 / Descuentos', icon: Flame },
  { key: 'porVencer', label: 'Por vencer', icon: Clock },
]

export function VibePromocionesNovedades({
  promociones,
  categoriaActiva,
}: {
  promociones: PromocionesNovedadesVista
  categoriaActiva?: string | null
}) {
  if (categoriaActiva && promociones.total === 0) return null

  const [activeTab, setActiveTab] = useState<TabKey>('paraTi')

  const items: readonly PromoNovedadItem[] = promociones[activeTab] ?? []

  return (
    <section className="mt-6 px-4" aria-labelledby="novedades-promos-title">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-5 text-vibe-violet" aria-hidden />
          <h3 id="novedades-promos-title" className="text-h2 text-foreground">
            Promociones
          </h3>
        </div>
        <Link
          href="/cliente/novedades"
          className="shrink-0 text-label-sm font-bold text-vibe-violet hover:underline"
        >
          Ver todas{promociones.total > 0 ? ` (${promociones.total})` : ''}
        </Link>
      </div>

      {/* Chips de filtro interactivo */}
      <RailOverflowHint className="from-vibe-fondo via-vibe-fondo/90 to-transparent text-vibe-violet">
        <div className="flex gap-2 overflow-x-auto pb-2 pr-10 scrollbar-none">
          {TABS.map((tab) => {
            const count = promociones[tab.key]?.length ?? 0
            const Icon = tab.icon
            const isActive = activeTab === tab.key
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-label-sm font-bold transition-all ${isActive
                  ? 'grad-vibe text-white shadow-sm'
                  : 'border border-vibe-borde bg-card text-muted-foreground hover:text-foreground'
                  }`}
              >
                <Icon className="size-3.5" />
                <span>{tab.label}</span>
                {count > 0 ? (
                  <span
                    className={`rounded-full px-1.5 py-0.2 text-label-sm font-bold ${isActive ? 'bg-white/20 text-white' : 'bg-vibe-chip text-muted-foreground'
                      }`}
                  >
                    {count}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      </RailOverflowHint>

      {/* Lista de promociones activas */}
      {items.length === 0 ? (
        <div className="mt-2 rounded-xl border border-dashed border-vibe-borde bg-card/40 p-6 text-center text-small text-muted-foreground">
          No hay promociones en esta sección en este momento.
        </div>
      ) : (
        <RailOverflowHint className="mt-2 from-vibe-fondo via-vibe-fondo/90 to-transparent text-vibe-violet">
          <div className="flex gap-3 overflow-x-auto pb-2 pr-10 scrollbar-none">
            {items.map((p) => (
              <Link
                key={p.id}
                href={p.href}
                className="group flex w-60 shrink-0 flex-col justify-between rounded-xl border border-vibe-borde bg-card p-3 elevation-1 transition-transform duration-fast hover:scale-[1.01] active:scale-[0.99]"
              >
                <div>
                  <div className="relative mb-2.5 h-28 w-full overflow-hidden rounded-lg bg-vibe-niebla">
                    {p.imagenUrl ? (
                      <Image src={p.imagenUrl} alt="" fill sizes="15rem" className="object-cover" />
                    ) : (
                      <span className="flex size-full items-center justify-center text-h2 font-bold text-vibe-violet">
                        {p.empresa.nombre.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    {p.descuentoTexto ? (
                      <span className="absolute bottom-1.5 left-1.5 rounded bg-vibe-violet px-2 py-0.5 text-label-sm font-bold text-white shadow">
                        {p.descuentoTexto}
                      </span>
                    ) : null}
                    {p.esPrivadaMiembros ? (
                      <span className="absolute top-1.5 right-1.5 rounded-full bg-black/75 px-2 py-0.5 text-label-sm font-bold text-amber-300 backdrop-blur-sm">
                        Exclusivo
                      </span>
                    ) : null}
                    {p.diasRestantes != null && p.diasRestantes <= 3 ? (
                      <span className="absolute top-1.5 left-1.5 rounded-full bg-red-600/90 px-2 py-0.5 text-label-sm font-bold text-white backdrop-blur-sm">
                        {p.diasRestantes === 0 ? 'Vence hoy' : `${p.diasRestantes}d restantes`}
                      </span>
                    ) : null}
                  </div>

                  <div className="space-y-1">
                    <span className="line-clamp-1 block text-small text-muted-foreground">
                      {p.empresa.nombre}
                    </span>
                    <h4 className="line-clamp-2 text-label-md font-bold leading-snug text-foreground transition-colors group-hover:text-vibe-violet">
                      {p.titulo}
                    </h4>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between border-t border-vibe-borde/50 pt-2 text-small text-muted-foreground">
                  <span className="truncate font-medium">
                    {p.precioTexto ? (
                      <span className="text-label-md font-bold text-vibe-violet">{p.precioTexto}</span>
                    ) : (
                      <span className="text-caption">Ver beneficio</span>
                    )}
                  </span>
                  <span className="inline-flex items-center gap-1 text-label-sm font-semibold text-vibe-violet">
                    Aprovechar <ArrowRight className="size-3" />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </RailOverflowHint>
      )}
    </section>
  )
}
