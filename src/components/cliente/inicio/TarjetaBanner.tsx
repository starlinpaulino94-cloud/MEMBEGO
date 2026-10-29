import Image from 'next/image'
import { ArrowRight, ImageIcon, Star } from 'lucide-react'
import type { HeroInicio } from '@/modules/home/vista'
import {
  FORMATO_BANNER_POR_DEFECTO,
  formatoAdmitePie,
  clasePanel,
  type FormatoBanner,
} from '@/modules/home/banner-formatos'

/**
 * LA TARJETA DEL BANNER, en sus tres formatos (aprobado 2026-10-29).
 *
 * Es la MISMA tarjeta en el inicio del cliente (`VibeHero`) y en la vista
 * previa del editor del panel: lo que el negocio ve al configurar es,
 * literalmente, lo que la clientela verá. Por eso no sabe de enlaces ni de
 * carruseles: recibe el hero y pinta.
 *
 *  · SOLO_IMAGEN    → la imagen y nada más. Sin imagen no hay tarjeta posible,
 *                     así que cae al formato con texto (el editor no deja
 *                     publicarlo así; esto cubre una imagen que dejó de existir).
 *  · TITULAR_ARRIBA → panel de color con el titular, y la foto debajo, entera.
 *  · TEXTO_ENCIMA   → velo, sello, titular, tarjeta del negocio y botón.
 *
 * El tamaño lo pone quien la monta (`className`): el carrusel usa 86vw × 380px,
 * la vista previa un teléfono más pequeño. Dentro, todo es relativo.
 */
export function formatoEfectivo(hero: Pick<HeroInicio, 'formato' | 'imagen'>): FormatoBanner {
  const formato = hero.formato ?? FORMATO_BANNER_POR_DEFECTO
  return formato === 'SOLO_IMAGEN' && !hero.imagen ? 'TEXTO_ENCIMA' : formato
}

/** Si bajo esta tarjeta va el pie con el negocio y el botón. */
export function llevaPie(hero: Pick<HeroInicio, 'formato' | 'imagen' | 'mostrarPie'>): boolean {
  return formatoAdmitePie(formatoEfectivo(hero)) && (hero.mostrarPie ?? true)
}

export function TarjetaBanner({
  hero,
  className,
  prioridad = false,
  sinOptimizar = false,
  compacta = false,
}: {
  hero: HeroInicio
  className?: string
  /** La primera del carrusel es LCP: se carga con prioridad. */
  prioridad?: boolean
  /** La vista previa del editor enseña URLs recién subidas: sin pasar por el optimizador. */
  sinOptimizar?: boolean
  /** Teléfono de la vista previa: tipografía un paso más pequeña. */
  compacta?: boolean
}) {
  const formato = formatoEfectivo(hero)
  const titular = compacta ? 'text-2xl' : 'text-3xl md:text-4xl'

  const foto = hero.imagen ? (
    <Image
      src={hero.imagen}
      alt=""
      fill
      sizes="(min-width: 640px) 340px, 86vw"
      className="object-cover"
      priority={prioridad}
      unoptimized={sinOptimizar}
    />
  ) : (
    <span aria-hidden className="grad-vibe-header absolute inset-0" />
  )

  if (formato === 'SOLO_IMAGEN') {
    return (
      <div className={`relative overflow-hidden rounded-2xl elevation-2 ${className ?? ''}`}>
        {foto}
      </div>
    )
  }

  if (formato === 'TITULAR_ARRIBA') {
    return (
      <div
        className={`relative flex flex-col overflow-hidden rounded-2xl elevation-2 ${clasePanel(hero.colorPanel)} ${className ?? ''}`}
      >
        <div className={`space-y-1 ${compacta ? 'px-4 pt-4 pb-3' : 'px-5 pt-6 pb-4'}`}>
          <h2 className={`font-display ${titular} font-extrabold leading-[1.05] text-foreground`}>{hero.titulo}</h2>
          {hero.subtitulo ? (
            <p className="line-clamp-2 text-small font-medium text-muted-foreground">{hero.subtitulo}</p>
          ) : null}
        </div>
        <div className={`relative flex-1 overflow-hidden rounded-xl ${compacta ? 'mx-3 mb-3' : 'mx-3.5 mb-3.5'}`}>
          {hero.imagen ? (
            foto
          ) : (
            <span className="grad-vibe-header absolute inset-0 flex items-center justify-center text-white/80">
              <ImageIcon className="size-8" aria-hidden />
            </span>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={`relative overflow-hidden rounded-2xl elevation-2 ${className ?? ''}`}>
      {foto}
      <span aria-hidden className="grad-vibe-noche absolute inset-0" />
      <div className={`relative z-10 flex h-full flex-col justify-between ${compacta ? 'p-4' : 'p-5'}`}>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="grad-vibe inline-block rounded-full px-3 py-1 text-label-sm font-bold uppercase tracking-wider text-white shadow">
              {hero.etiqueta ?? 'Novedad destacada'}
            </span>
            {hero.descuento ? (
              <span className="rounded-full bg-amber-400 px-2.5 py-0.5 text-label-sm font-extrabold text-black shadow">
                {hero.descuento}
              </span>
            ) : null}
          </div>
          <h2 className={`mt-2 font-display ${titular} font-extrabold leading-tight text-white drop-shadow`}>
            {hero.titulo}
          </h2>
          {hero.subtitulo ? (
            <span className="line-clamp-2 block text-small font-medium text-vibe-celeste drop-shadow-sm">
              {hero.subtitulo}
            </span>
          ) : null}
        </div>

        <div className={compacta ? 'space-y-2' : 'space-y-3'}>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-vibe-borde bg-card/95 p-3 backdrop-blur shadow-sm">
            <div className="min-w-0">
              <span className="block truncate text-label-sm font-bold text-foreground">{hero.empresa}</span>
              {hero.precio ? (
                <span className="block truncate text-label-md font-extrabold text-vibe-violet">{hero.precio}</span>
              ) : hero.planDesde ? (
                <span className="block truncate text-label-sm font-bold text-vibe-ink">{hero.planDesde}</span>
              ) : null}
            </div>
            {hero.valoracion != null && Number.isFinite(Number(hero.valoracion)) ? (
              <span className="flex shrink-0 items-center gap-1 rounded-lg bg-vibe-niebla px-2 py-1">
                <Star className="size-3.5 fill-vibe-violet text-vibe-violet" aria-hidden />
                <span className="text-label-sm font-bold text-foreground tabular-nums">
                  {Number(hero.valoracion).toFixed(1)}
                </span>
              </span>
            ) : null}
          </div>
          <span className="grad-vibe-cta flex w-full items-center justify-center gap-2 rounded-full py-3 text-label-md font-bold text-white shadow">
            {hero.cta}
            <ArrowRight className="size-4" aria-hidden />
          </span>
        </div>
      </div>
    </div>
  )
}

/**
 * El pie bajo la tarjeta (solo imagen y titular arriba): quién es y adónde
 * lleva, sin tapar la imagen. Como el caption de Amazon, pero con el botón.
 */
export function PieBanner({ hero, compacta = false }: { hero: HeroInicio; compacta?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 ${compacta ? 'px-0.5 pt-1.5' : 'px-1 pt-2'}`}>
      <div className="min-w-0">
        <span className="block truncate text-label-sm font-bold text-foreground">{hero.empresa}</span>
        {hero.precio ? (
          <span className="block truncate text-label-sm font-extrabold text-vibe-violet">{hero.precio}</span>
        ) : hero.planDesde ? (
          <span className="block truncate text-label-sm font-bold text-vibe-ink">{hero.planDesde}</span>
        ) : null}
      </div>
      <span className="flex shrink-0 items-center gap-1 text-label-sm font-bold text-vibe-violet">
        {hero.cta}
        <ArrowRight className="size-3.5" aria-hidden />
      </span>
    </div>
  )
}
