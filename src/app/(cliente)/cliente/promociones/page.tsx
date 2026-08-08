import Link from 'next/link'
import {
  AlertCircle,
  Heart,
  Star,
  Sparkles,
  Clock,
  Compass,
  ThumbsUp,
  Flame,
  Tag,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import {
  getPromoFeed,
  getPromocionesGuardadas,
  getGuardadasIds,
  type PromoFeed,
} from '@/modules/social/queries'
import { PromotionCard } from '@/components/public/PromotionCard'
import { EmptyState } from '@/components/system/EmptyState'
import { BusinessCard } from '@/components/marketplace/BusinessCard'
import { PageHeader } from '@/components/ui/page-header'
import { SectionHeader } from '@/components/ui/section-header'
import { SavePromoButton } from '@/components/cliente/SavePromoButton'
import { Button } from '@/components/ui/button'
import type { PromotionPublic } from '@/modules/marketplace/types'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Ofertas',
  description: 'Ofertas y beneficios disponibles para ti',
}

function PromoGridConGuardar({
  promociones,
  guardadasIds,
}: {
  promociones: PromotionPublic[]
  guardadasIds: Set<string>
}) {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {promociones.map((p) => (
        <div key={p.id} className="relative">
          <PromotionCard promotion={p} hrefBase="/cliente/promociones" />
          <SavePromoButton promocionId={p.id} guardada={guardadasIds.has(p.id)} />
        </div>
      ))}
    </div>
  )
}

/**
 * Sección del feed de ofertas.
 *
 * DS 2.0 · Fase 4: antes cada sección recibía su propio `iconBg` e `iconClass`
 * y acababa eligiendo colores sueltos —`fill-rose-500`, `fill-amber-400`— sin
 * más razón que decorar. Ahora el icono es siempre de marca y lo que distingue
 * a una sección de otra es su TÍTULO, que es lo que la gente lee.
 */
function SeccionPromos({
  icon: Icon,
  titulo,
  descripcion,
  promociones,
  guardadasIds,
}: {
  icon: LucideIcon
  titulo: string
  descripcion?: string
  promociones: PromotionPublic[]
  guardadasIds: Set<string>
}) {
  if (promociones.length === 0) return null
  return (
    <section>
      <SectionHeader
        title={titulo}
        description={descripcion}
        action={
          <span className="inline-flex items-center gap-1.5 text-caption">
            <Icon className="h-4 w-4 text-primary" aria-hidden />
            {promociones.length}
            <span className="sr-only">ofertas</span>
          </span>
        }
      />
      <PromoGridConGuardar promociones={promociones} guardadasIds={guardadasIds} />
    </section>
  )
}

export default async function PromocionesDisponiblesPage() {
  const user = await requireRole('CLIENTE')

  let feed: PromoFeed | null = null
  let guardadas: PromotionPublic[] = []
  let guardadasIds = new Set<string>()
  let loadError = false
  try {
    ;[feed, guardadas, guardadasIds] = await Promise.all([
      getPromoFeed(user.metadata.dbUserId),
      getPromocionesGuardadas(user.metadata.dbUserId),
      getGuardadasIds(user.metadata.dbUserId),
    ])
  } catch (e) {
    loadError = true
    console.error('[cliente-promociones]', e)
  }

  const sinPromos =
    feed != null &&
    feed.misEmpresas.length === 0 &&
    feed.destacadas.length === 0 &&
    feed.nuevas.length === 0 &&
    feed.expiranPronto.length === 0 &&
    feed.recomendadas.length === 0

  return (
    <div>
      <PageHeader
        eyebrow="Beneficios"
        title="Ofertas para ti"
        description="Lo de tus empresas favoritas primero. Todo canjeable con tu QR."
        action={
          <Button asChild variant="outline">
            <Link href="/cliente/explorar">
              <Compass aria-hidden />
              Explorar empresas
            </Link>
          </Button>
        }
      />

      {loadError || feed == null ? (
        <EmptyState
          icon={AlertCircle}
          title="No pudimos cargar las promociones"
          description="Intenta de nuevo en unos momentos."
          action={
            <Button asChild variant="outline">
              <Link href="/cliente/promociones">Reintentar</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-10">
          {/* Guardadas */}
          <SeccionPromos
            icon={Heart}
            titulo="Guardadas"
            promociones={guardadas}
            guardadasIds={guardadasIds}
          />

          {/* Mis empresas: donde soy cliente + las que sigo */}
          <SeccionPromos
            icon={Star}
            titulo="De tus empresas"
            descripcion="Donde eres cliente y las que sigues. Tus favoritas primero."
            promociones={feed.misEmpresas}
            guardadasIds={guardadasIds}
          />

          {/* Destacadas */}
          <SeccionPromos
            icon={Flame}
            titulo="Destacadas"
            promociones={feed.destacadas}
            guardadasIds={guardadasIds}
          />

          {/* Nuevas */}
          <SeccionPromos
            icon={Sparkles}
            titulo="Nuevas"
            descripcion="Publicadas en los últimos 14 días."
            promociones={feed.nuevas}
            guardadasIds={guardadasIds}
          />

          {/* Expiran pronto */}
          <SeccionPromos
            icon={Clock}
            titulo="Expiran pronto"
            descripcion="Aprovéchalas antes de que venzan."
            promociones={feed.expiranPronto}
            guardadasIds={guardadasIds}
          />

          {/* Recomendadas */}
          <SeccionPromos
            icon={ThumbsUp}
            titulo="Recomendadas para ti"
            descripcion="De empresas parecidas a las que sigues."
            promociones={feed.recomendadas}
            guardadasIds={guardadasIds}
          />

          {/* Sin promociones */}
          {sinPromos && guardadas.length === 0 && (
            <EmptyState
              icon={Tag}
              title="Sin promociones activas"
              description="Sigue empresas para recibir sus promociones apenas se publiquen."
              action={
                <Button asChild size="lg">
                  <Link href="/cliente/explorar">Explorar empresas</Link>
                </Button>
              }
            />
          )}

          {/* Descubrir empresas */}
          {feed.empresasRecomendadas.length > 0 && (
            <section>
              <SectionHeader
                title="Descubrir empresas"
                description="También podrían interesarte."
                action={
                  <Button asChild variant="ghost" size="sm">
                    <Link href="/cliente/explorar">Ver todas</Link>
                  </Button>
                }
              />
              <ul className="grid gap-3 sm:grid-cols-2">
                {feed.empresasRecomendadas.map((c) => (
                  <li key={c.id} className="flex">
                    <BusinessCard
                      variant="compact"
                      hrefBase="/cliente/empresas"
                      className="w-full"
                      company={{
                        id: c.id,
                        name: c.name,
                        slug: c.slug,
                        type: c.type,
                        logoUrl: c.logoUrl,
                        bannerUrl: c.bannerUrl,
                        ciudad: c.ciudad,
                        activePromotionsCount: c.activePromotionsCount,
                        totalMembersCount: c.totalMembersCount,
                      }}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
