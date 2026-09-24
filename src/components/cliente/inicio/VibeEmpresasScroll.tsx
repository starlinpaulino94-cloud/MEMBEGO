'use client'

import Link from 'next/link'
import Image from 'next/image'
import { Store, Star, ArrowRight, ChevronRight, Heart } from 'lucide-react'
import type { EmpresaScrollItem } from '@/modules/home/vista'
import { RailOverflowHint } from '@/components/ui/RailOverflowHint'

export function VibeEmpresasScroll({
  empresas,
  total,
  categoriaActiva,
}: {
  empresas: readonly EmpresaScrollItem[]
  total: number
  categoriaActiva?: string | null
}) {
  if (empresas.length === 0) return null

  return (
    <section className="mt-6 px-4" aria-labelledby="vibe-empresas-title">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Store className="size-5 text-vibe-violet" aria-hidden />
          <h3 id="vibe-empresas-title" className="text-h2 text-foreground">
            Descubre y visita
          </h3>
        </div>
        <Link
          href={
            categoriaActiva
              ? `/cliente/explorar?category=${encodeURIComponent(categoriaActiva)}`
              : '/cliente/explorar'
          }
          className="flex items-center gap-0.5 text-label-sm font-bold text-vibe-violet hover:underline"
        >
          <span>Ver más</span>
          <ChevronRight className="size-4" />
        </Link>
      </div>

      <RailOverflowHint className="from-vibe-fondo via-vibe-fondo/90 to-transparent text-vibe-violet">
        <div className="flex gap-3 overflow-x-auto pb-2 pr-10 scrollbar-none">
          {empresas.map((e) => (
            <Link
              key={e.id}
              href={e.href}
              className="group flex w-48 shrink-0 flex-col justify-between rounded-xl border border-vibe-borde bg-card p-3 elevation-1 transition-transform duration-fast hover:scale-[1.01] active:scale-[0.99] sm:w-52 lg:w-60"
            >
              <div>
                <div className="relative mb-2.5 h-24 w-full overflow-hidden rounded-lg bg-vibe-niebla sm:h-28 lg:h-32">
                  {e.bannerUrl || e.logoUrl ? (
                    <Image
                      src={e.bannerUrl || e.logoUrl || ''}
                      alt={e.nombre}
                      fill
                      sizes="(min-width: 1024px) 15rem, 12rem"
                      className="object-cover transition-transform duration-normal group-hover:scale-105"
                    />
                  ) : (
                    <span className="flex size-full items-center justify-center text-h1 font-bold text-vibe-violet">
                      {e.nombre.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  {e.esMia ? (
                    <span className="absolute top-1.5 right-1.5 rounded-full bg-vibe-violet/90 p-1 text-white shadow">
                      <Heart className="size-3 fill-white" />
                    </span>
                  ) : null}
                  {e.etiquetaRelacion ? (
                    <span className="absolute bottom-1.5 left-1.5 rounded bg-card/90 px-2 py-0.5 text-xs font-bold text-vibe-violet backdrop-blur-sm">
                      {e.etiquetaRelacion}
                    </span>
                  ) : null}
                </div>

                <h4 className="line-clamp-1 text-label-md font-bold text-foreground transition-colors group-hover:text-vibe-violet">
                  {e.nombre}
                </h4>
                <p className="line-clamp-1 text-small text-muted-foreground">
                  {e.rubro ?? 'Negocio afiliado'}
                </p>
                {e.ciudad ? (
                  <p className="line-clamp-1 text-xs text-muted-foreground/80">
                    {e.ciudad}
                  </p>
                ) : null}
                {e.planes != null && e.planes > 0 ? (
                  <div className="mt-1.5 flex items-center">
                    <span className="rounded bg-vibe-lavanda/60 px-1.5 py-0.5 text-xs font-semibold text-vibe-violet">
                      {e.planes} {e.planes === 1 ? 'membresía' : 'membresías'}
                    </span>
                  </div>
                ) : null}
              </div>

              <div className="mt-2.5 flex items-center gap-1 border-t border-vibe-borde/40 pt-2 text-xs text-muted-foreground">
                {e.valoracion != null && Number.isFinite(Number(e.valoracion)) ? (
                  <>
                    <Star className="size-3 fill-amber-400 text-amber-400" />
                    <span className="font-bold tabular-nums text-foreground">
                      {Number(e.valoracion).toFixed(1)}
                    </span>
                    <span>({e.resenas})</span>
                  </>
                ) : (
                  <span>Nuevo</span>
                )}
              </div>
            </Link>
          ))}

          {/* Tarjeta de acción 'Explorar todas' */}
          <Link
            href="/cliente/explorar"
            className="flex w-36 shrink-0 flex-col items-center justify-center rounded-xl border border-dashed border-vibe-borde bg-card/40 p-4 text-center transition-colors hover:border-vibe-violet/50 hover:bg-card sm:w-40 lg:w-44"
          >
            <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-vibe-lavanda text-vibe-violet">
              <ArrowRight className="size-5" />
            </div>
            <span className="text-label-sm font-bold text-foreground">Explorar todas</span>
            <span className="text-xs text-muted-foreground">+{total} negocios</span>
          </Link>
        </div>
      </RailOverflowHint>
    </section>
  )
}
