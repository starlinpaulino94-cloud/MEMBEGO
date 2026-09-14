import Link from 'next/link'
import Image from 'next/image'
import { MapPin, Gift, Users, Star } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatMoney } from '@/lib/format'

/**
 * BUSINESS CARD — la ÚNICA familia de tarjetas de negocio (DS 2.0 · Fase 4).
 *
 * Antes había dos, muy distintas: la pública (`CompanyCard`) con banner,
 * logo flotante y un degradado atardecer, y la del explorador, con logo
 * cuadrado, precio ancla y botón de seguir. La misma empresa se veía de dos
 * maneras según por dónde llegaras, que es exactamente lo que hace que un
 * producto parezca varios productos.
 *
 * DÓNDE VIVE ESTE COMPONENTE Y POR QUÉ NO EN `packages/ui`:
 * el design system no depende de ningún framework —`TabsNav` recibe un
 * `render` justo para eso—, y esta tarjeta necesita `next/link` y
 * `next/image` para funcionar bien. Es un componente de PRODUCTO: se apoya en
 * los tokens y los primitives, pero conoce la aplicación. Esa es la frontera.
 */

export interface BusinessCardData {
  id: string
  name: string
  slug: string
  type: string
  logoUrl: string | null
  bannerUrl: string | null
  ciudad: string | null
  descripcion?: string | null
  totalMembersCount?: number
  activePromotionsCount?: number
  averageRating?: number | null
  isFeatured?: boolean
  /** Plan activo más barato: el ancla "desde $X". */
  desdePlan?: { nombre: string; precio: number } | null
}

const TIPO_LABEL: Record<string, string> = {
  carwash: 'Car Wash',
  restaurante: 'Restaurante',
  gimnasio: 'Gimnasio',
  salon: 'Salón',
}

/**
 * `map` se creó en la Fase 4 pensando en los resultados del mapa y se retiró
 * en la Fase 5 al construirlos: un resultado del mapa es una SUCURSAL —con
 * distancia, si está abierta ahora y su propia acción de cómo llegar—, no una
 * empresa. Tiene su tarjeta en `MapaCercaDeMi`. Mejor dos piezas honestas que
 * una deformada para cubrir las dos.
 */
export type BusinessCardVariant = 'standard' | 'compact' | 'featured'

interface BusinessCardProps {
  company: BusinessCardData
  /** Base de la ruta del perfil: '/empresas' en público, '/cliente/empresas' dentro. */
  hrefBase?: string
  variant?: BusinessCardVariant
  /** Acción secundaria: seguir, guardar… Se pinta fuera del enlace. */
  action?: React.ReactNode
  className?: string
}

function Logo({
  company,
  size,
}: {
  company: BusinessCardData
  size: 'sm' | 'md' | 'lg'
}) {
  const clases = {
    sm: 'h-11 w-11 text-[13px]',
    md: 'h-12 w-12 text-small',
    lg: 'h-16 w-16 text-h3',
  }[size]

  if (company.logoUrl) {
    return (
      <div className={cn('relative shrink-0 overflow-hidden rounded-lg bg-muted', clases)}>
        <Image src={company.logoUrl} alt="" fill sizes="64px" className="object-cover" />
      </div>
    )
  }
  return (
    <div
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center rounded-lg bg-brand-primary-soft font-bold text-primary',
        clases
      )}
    >
      {company.name.slice(0, 2).toUpperCase()}
    </div>
  )
}

/** Metadatos de una línea: tipo · ciudad. */
function Meta({ company }: { company: BusinessCardData }) {
  return (
    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-caption">
      <span>{TIPO_LABEL[company.type] ?? company.type}</span>
      {company.ciudad && (
        <>
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5" aria-hidden />
            {company.ciudad}
          </span>
        </>
      )}
    </p>
  )
}

/** Prueba social: promociones y miembros. Solo si aportan algo. */
function Stats({ company }: { company: BusinessCardData }) {
  const promos = company.activePromotionsCount ?? 0
  const miembros = company.totalMembersCount ?? 0
  if (promos === 0 && miembros === 0 && company.averageRating == null) return null

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption">
      {promos > 0 && (
        <span className="inline-flex items-center gap-1.5">
          <Gift className="h-4 w-4 text-primary" aria-hidden />
          {promos} {promos === 1 ? 'promoción' : 'promociones'}
        </span>
      )}
      {miembros > 0 && (
        <span className="inline-flex items-center gap-1.5">
          <Users className="h-4 w-4 text-primary" aria-hidden />
          {miembros} {miembros === 1 ? 'miembro' : 'miembros'}
        </span>
      )}
      {company.averageRating != null && (
        <span className="inline-flex items-center gap-1.5 tabular-nums">
          <Star className="h-4 w-4 fill-warning text-warning" aria-hidden />
          {Number(company.averageRating).toFixed(1)}
          <span className="sr-only">de 5</span>
        </span>
      )}
    </div>
  )
}

export function BusinessCard({
  company,
  hrefBase = '/empresas',
  variant = 'standard',
  action,
  className,
}: BusinessCardProps) {
  const href = `${hrefBase}/${company.slug}`
  const precio = company.desdePlan

  // ── compact: filas de lista, resultados del mapa, carriles ────────────────
  if (variant === 'compact') {
    return (
      <div
        className={cn(
          // `relative`: la capa invisible que hace clicable toda la fila se
          // ancla aquí. Sin esto se estiraría hasta el <body>.
          'card-interactive relative flex items-center gap-3 rounded-lg border border-border bg-card p-3',
          className
        )}
      >
        <Logo company={company} size="sm" />
        <div className="min-w-0 flex-1">
          <Link href={href} className="outline-none focus-visible:underline">
            {/* `after:absolute inset-0` hace clicable toda la tarjeta sin
                anidar el botón de acción dentro del enlace, que sería HTML
                inválido y rompería el teclado. */}
            <span className="absolute inset-0" aria-hidden />
            <h3 className="truncate text-h4 text-foreground">{company.name}</h3>
          </Link>
          <Meta company={company} />
        </div>
        {precio && (
          <div className="shrink-0 text-right">
            <p className="text-small font-bold tabular-nums text-primary">
              {formatMoney(precio.precio)}
            </p>
            <p className="text-caption">desde</p>
          </div>
        )}
        {action && <div className="relative shrink-0">{action}</div>}
      </div>
    )
  }

  // ── estándar/destacada: guiada por IMAGEN, como la tarjeta del Inicio ─────
  //
  // La imagen manda (dirección Amazon del usuario): banner arriba con la
  // ciudad como sello, cuerpo con logo, nombre, valoración y el gancho del
  // plan más barato. La tarjeta entera es el enlace mediante la capa
  // invisible; el slot de acción (seguir) queda por encima y sigue clicable.
  // El botón «Ver membresías» se retira: el compromiso se pide en el perfil.
  return (
    <div
      className={cn(
        "group relative flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card elevation-1 transition-colors duration-fast hover:border-primary/40",
        className
      )}
    >
      <div className="relative aspect-16/10 w-full bg-muted">
        {company.bannerUrl ? (
          <Image
            src={company.bannerUrl}
            alt=""
            fill
            sizes="(max-width: 640px) 100vw, 400px"
            className="object-cover transition-transform duration-base group-hover:scale-105"
          />
        ) : (
          <span aria-hidden className="flex size-full items-center justify-center bg-brand-primary-soft text-h1 font-bold text-primary">
            {company.name.slice(0, 2).toUpperCase()}
          </span>
        )}
        {company.ciudad && (
          <span className="absolute left-2 top-2 rounded-full bg-card/95 px-2 py-0.5 text-label-sm font-semibold text-foreground">
            {company.ciudad}
          </span>
        )}
        {company.isFeatured && (
          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-card/95 px-2 py-0.5 text-label-sm font-semibold text-foreground">
            <Star className="size-3 fill-retail-star text-retail-star" aria-hidden />
            Destacada
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-3">
        <div className="flex items-center gap-2.5">
          <Logo company={company} size="sm" />
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-h4 text-foreground">
              <Link href={href} className="outline-none focus-visible:underline">
                {/* La capa invisible hace clicable toda la tarjeta sin anidar
                    la acción dentro del enlace (HTML inválido). */}
                <span className="absolute inset-0" aria-hidden />
                {company.name}
              </Link>
            </h3>
            <Meta company={company} />
          </div>
          {action && <div className="relative z-10 shrink-0">{action}</div>}
        </div>

        {company.descripcion && (
          <p className="line-clamp-2 text-caption text-muted-foreground">{company.descripcion}</p>
        )}

        <Stats company={company} />

        {precio && (
          <span className="mt-auto inline-flex w-fit items-center gap-1.5 rounded-full border border-border px-3 py-1 pt-1 text-label-md text-primary">
            {precio.nombre}
            <span className="font-bold tabular-nums">{formatMoney(precio.precio)}</span>
          </span>
        )}
      </div>
    </div>
  )
}
