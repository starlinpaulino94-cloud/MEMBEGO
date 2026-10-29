import Image from 'next/image'
import { ArrowRight, ImageIcon, Star } from 'lucide-react'
import type { HeroInicio } from '@/modules/home/vista'
import {
  FORMATO_BANNER_POR_DEFECTO,
  formatoAdmitePie,
  formatoRealizable,
  clasePanel,
  textoSobre,
  type FormatoBanner,
} from '@/modules/home/banner-formatos'
import { CuentaAtras } from './CuentaAtras'

/**
 * LA TARJETA DEL BANNER, en sus diez plantillas (aprobado 2026-10-29).
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
 *  · PRECIO_GRANDE  → nombre y precio grandes sobre el color de la foto, la foto debajo.
 *  · ANTES_AHORA    → el precio de oferta grande y el anterior tachado.
 *  · DESCUENTO_SELLO→ la foto con un sello redondo con el descuento.
 *  · CUENTA_ATRAS   → la foto con días, horas y minutos para que venza.
 *  · TRES_EN_UNO    → un titular y tres fotos (una colección).
 *  · COLLAGE        → dos fotos del mismo trabajo y un titular.
 *  · MEMBRESIA      → precio por periodo y lo que incluye, sobre el degradado de marca.
 *
 * Una plantilla que pide lo que no hay (fotos, precio, fecha) cae a la más
 * parecida (`formatoRealizable`): nunca se pinta un hueco.
 *
 * El tamaño lo pone quien la monta (`className`): el carrusel usa 86vw × 380px,
 * la vista previa un teléfono más pequeño. Dentro, todo es relativo.
 */
export function formatoEfectivo(
  hero: Pick<HeroInicio, 'formato' | 'imagen'> & Partial<Pick<HeroInicio, 'imagenes' | 'precio' | 'precioAntes' | 'vence'>>,
): FormatoBanner {
  return formatoRealizable(hero.formato ?? FORMATO_BANNER_POR_DEFECTO, {
    imagen: hero.imagen,
    nImagenes: hero.imagenes?.length ?? (hero.imagen ? 1 : 0),
    precio: !!hero.precio,
    precioAntes: !!hero.precioAntes,
    vence: !!hero.vence,
  })
}

/** Si bajo esta tarjeta va el pie con el negocio y el botón. */
export function llevaPie(
  hero: Pick<HeroInicio, 'formato' | 'imagen' | 'mostrarPie'> & Partial<Pick<HeroInicio, 'imagenes' | 'precio' | 'precioAntes' | 'vence'>>,
): boolean {
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

  const base = `relative flex flex-col overflow-hidden rounded-2xl elevation-2 ${className ?? ''}`
  /** Foto dentro de un recuadro de una plantilla con panel. */
  const recuadro = (src: string | undefined, extra = '') => (
    <div className={`relative overflow-hidden rounded-xl ${extra}`}>
      {src ? (
        <Image src={src} alt="" fill sizes="(min-width: 640px) 340px, 86vw" className="object-cover" unoptimized={sinOptimizar} />
      ) : (
        <span className="grad-vibe-header absolute inset-0 flex items-center justify-center text-white/80">
          <ImageIcon className="size-8" aria-hidden />
        </span>
      )}
    </div>
  )
  const pastilla = (
    <span className="grad-vibe-cta m-3 mt-2 flex items-center justify-center gap-2 rounded-full py-2.5 text-label-md font-bold text-white shadow">
      {hero.cta}
      <ArrowRight className="size-4" aria-hidden />
    </span>
  )

  if (formato === 'PRECIO_GRANDE') {
    // Colores de CONTENIDO: el de la foto (o el de la marca, o el del rubro) y el texto que se lee sobre él.
    const color = hero.colorFondo ?? undefined
    const texto = textoSobre(hero.colorFondo ?? '') === 'claro' ? 'white' : 'oklch(0.2 0 0)'
    return (
      <div className={base} style={{ backgroundColor: color, color: texto }}>
        <div className={`space-y-0.5 ${compacta ? 'px-4 pt-4 pb-2' : 'px-5 pt-5 pb-3'}`}>
          <span className="block text-label-sm font-bold uppercase tracking-wider opacity-80">{hero.etiqueta ?? 'Nuevo'}</span>
          <h2 className={`font-display ${compacta ? 'text-xl' : 'text-2xl'} font-extrabold leading-tight`}>{hero.titulo}</h2>
          {hero.precio ? <p className={`font-display ${compacta ? 'text-2xl' : 'text-3xl'} font-extrabold tabular-nums leading-none`}>{hero.precio}</p> : null}
        </div>
        {recuadro(hero.imagen ?? undefined, 'mx-3 flex-1')}
        <span className="m-3 mt-2 flex items-center justify-center gap-2 rounded-full bg-white py-2.5 text-label-md font-bold" style={{ color }}>
          {hero.cta}
          <ArrowRight className="size-4" aria-hidden />
        </span>
      </div>
    )
  }

  if (formato === 'ANTES_AHORA') {
    return (
      <div className={`${base} bg-warning-soft text-foreground`}>
        <div className={`space-y-0.5 ${compacta ? 'px-4 pt-4 pb-2' : 'px-5 pt-5 pb-3'}`}>
          <h2 className={`font-display ${compacta ? 'text-xl' : 'text-2xl'} font-extrabold leading-tight`}>{hero.titulo}</h2>
          <p className="flex items-baseline gap-2 tabular-nums">
            <span className={`font-display ${compacta ? 'text-2xl' : 'text-3xl'} font-extrabold leading-none`}>
              <span className="sr-only">Ahora </span>
              {hero.precio}
            </span>
            <span className="text-small text-muted-foreground line-through">
              <span className="sr-only">Antes </span>
              {hero.precioAntes}
            </span>
            {hero.descuento ? <span className="rounded-full bg-warning px-2 py-0.5 text-label-sm font-extrabold text-warning-foreground">{hero.descuento}</span> : null}
          </p>
        </div>
        {recuadro(hero.imagen ?? undefined, 'mx-3 flex-1')}
        {pastilla}
      </div>
    )
  }

  if (formato === 'DESCUENTO_SELLO') {
    return (
      <div className={`${base} justify-end`}>
        {foto}
        <span aria-hidden className="grad-vibe-noche absolute inset-0" />
        <span className={`absolute right-3 top-3 flex ${compacta ? 'size-16 text-lg' : 'size-20 text-xl'} items-center justify-center rounded-full bg-warning text-center font-display font-extrabold leading-none text-warning-foreground shadow`}>
          {hero.descuento ?? hero.etiqueta ?? 'Oferta'}
        </span>
        <h2 className={`relative z-10 p-4 font-display ${compacta ? 'text-xl' : 'text-2xl'} font-extrabold leading-tight text-white drop-shadow`}>{hero.titulo}</h2>
      </div>
    )
  }

  if (formato === 'CUENTA_ATRAS') {
    return (
      <div className={`${base} justify-between`}>
        {foto}
        <span aria-hidden className="absolute inset-0 bg-black/45" />
        <div className={`relative z-10 space-y-1 ${compacta ? 'p-4' : 'p-5'}`}>
          <span className="inline-block rounded-full bg-warning px-3 py-1 text-label-sm font-extrabold uppercase tracking-wider text-warning-foreground">Termina pronto</span>
          <h2 className={`font-display ${compacta ? 'text-xl' : 'text-2xl'} font-extrabold leading-tight text-white drop-shadow`}>{hero.titulo}</h2>
        </div>
        <div className={`relative z-10 ${compacta ? 'p-3' : 'p-4'}`}>{hero.vence ? <CuentaAtras vence={hero.vence} /> : null}</div>
      </div>
    )
  }

  if (formato === 'TRES_EN_UNO') {
    const fotos = (hero.imagenes ?? []).slice(0, 3)
    return (
      <div className={`${base} bg-success-soft text-foreground`}>
        <div className={compacta ? 'px-4 pt-4 pb-2' : 'px-5 pt-5 pb-3'}>
          <h2 className={`font-display ${compacta ? 'text-xl' : 'text-2xl'} font-extrabold leading-tight`}>{hero.titulo}</h2>
        </div>
        <div className="mx-3 mb-3 grid flex-1 grid-cols-3 gap-1.5">
          {fotos.map((f, i) => (
            <div key={`${f}-${i}`} className="relative overflow-hidden rounded-lg">
              <Image src={f} alt="" fill sizes="120px" className="object-cover" unoptimized={sinOptimizar} />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (formato === 'COLLAGE') {
    const fotos = (hero.imagenes ?? []).slice(0, 2)
    return (
      <div className={`${base} bg-danger-soft text-foreground`}>
        <div className="grid flex-1 grid-cols-2 gap-1 p-1">
          {fotos.map((f, i) => (
            <div key={`${f}-${i}`} className="relative overflow-hidden rounded-xl">
              <Image src={f} alt="" fill sizes="170px" className="object-cover" unoptimized={sinOptimizar} />
            </div>
          ))}
        </div>
        <h2 className={`px-4 py-3 text-center font-display ${compacta ? 'text-lg' : 'text-xl'} font-extrabold leading-tight`}>{hero.titulo}</h2>
      </div>
    )
  }

  if (formato === 'MEMBRESIA') {
    return (
      <div className={`${base} grad-vibe-header justify-between text-white`}>
        <div className={`space-y-1 ${compacta ? 'p-4' : 'p-5'}`}>
          <span className="block text-label-sm font-bold uppercase tracking-wider text-vibe-celeste">Membresía</span>
          <h2 className={`font-display ${compacta ? 'text-xl' : 'text-3xl'} font-extrabold leading-tight`}>{hero.titulo}</h2>
          {hero.subtitulo ? <p className="line-clamp-2 text-small font-medium text-vibe-celeste">{hero.subtitulo}</p> : null}
        </div>
        <div className={`space-y-1 ${compacta ? 'p-4' : 'p-5'}`}>
          {hero.precio ? <p className={`font-display ${compacta ? 'text-2xl' : 'text-3xl'} font-extrabold tabular-nums leading-none`}>{hero.precio}</p> : null}
          {hero.detalle ? <p className="text-small font-medium text-vibe-celeste">{hero.detalle}</p> : null}
          <span className="mt-2 flex items-center justify-center gap-2 rounded-full bg-white py-2.5 text-label-md font-bold text-vibe-violet">
            {hero.cta}
            <ArrowRight className="size-4" aria-hidden />
          </span>
        </div>
      </div>
    )
  }

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
              <span className="rounded-full bg-warning px-2.5 py-0.5 text-label-sm font-extrabold text-warning-foreground shadow">
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
