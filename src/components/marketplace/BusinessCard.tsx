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
      <div className={cn('relative shrink-0 overflow-hidden rounded-xl bg-muted', clases)}>
        <Image src={company.logoUrl} alt="" fill sizes="64px" className="object-cover" />
      </div>
    )
  }
  return (
    <div
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center rounded-xl bg-gradient-brand font-bold text-white',
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
          'card-interactive relative flex items-center gap-3 rounded-xl border border-border bg-card p-3',
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

  // ── featured: con banner, para destacar en una vitrina ────────────────────
  const conBanner = variant === 'featured'

  return (
    <div
      className={cn(
        'card-interactive flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card',
        className
      )}
    >
      {conBanner && (
        <div className="relative h-28 w-full overflow-hidden bg-gradient-brand">
          {company.bannerUrl && (
            <Image
              src={company.bannerUrl}
              alt=""
              fill
              sizes="(max-width: 640px) 100vw, 400px"
              className="object-cover"
            />
          )}
          {company.isFeatured && (
            <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-card/90 px-2.5 py-1 text-caption font-semibold text-foreground backdrop-blur">
              <Star className="h-3.5 w-3.5 fill-warning text-warning" aria-hidden />
              Destacada
            </span>
          )}
        </div>
      )}

      <div className="flex flex-1 flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Logo company={company} size={conBanner ? 'lg' : 'md'} />
            <div className="min-w-0">
              <h3 className="truncate text-h3 text-foreground">
                <Link href={href} className="outline-none hover:underline focus-visible:underline">
                  {company.name}
                </Link>
              </h3>
              <Meta company={company} />
            </div>
          </div>
          {precio && (
            <div className="shrink-0 text-right">
              <p className="text-h3 tabular-nums text-primary">{formatMoney(precio.precio)}</p>
              <p className="text-caption">desde / mes</p>
            </div>
          )}
        </div>

        {precio?.nombre && (
          <p className="-mt-2 text-small font-semibold text-foreground">{precio.nombre}</p>
        )}

        {company.descripcion && (
          <p className="line-clamp-2 text-small text-muted-foreground">{company.descripcion}</p>
        )}

        <div className="mt-auto space-y-4">
          <Stats company={company} />
          <div className="flex items-center gap-2">
            <Link
              href={href}
              className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg bg-primary px-4 text-small font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 active:scale-[0.99]"
            >
              Ver membresías
            </Link>
            {action}
          </div>
        </div>
      </div>
    </div>
  )
}
