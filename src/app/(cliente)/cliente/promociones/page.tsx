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
import { CompanyCard } from '@/components/public/CompanyCard'
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

function SeccionPromos({
  icon: Icon,
  iconBg,
  iconClass,
  titulo,
  descripcion,
  count,
  promociones,
  guardadasIds,
}: {
  icon: LucideIcon
  iconBg: string
  iconClass: string
  titulo: string
  descripcion?: string
  count?: number
  promociones: PromotionPublic[]
  guardadasIds: Set<string>
}) {
  if (promociones.length === 0) return null
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${iconBg}`}>
          <Icon className={`h-4.5 w-4.5 ${iconClass}`} />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-foreground">{titulo}</h2>
            {count != null && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                {count}
              </span>
            )}
          </div>
          {descripcion && (
            <p className="text-sm text-muted-foreground">{descripcion}</p>
          )}
        </div>
      </div>
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
    <main className="container max-w-5xl py-8">
      {/* ── Cabecera ──────────────────────────────────────────────────────── */}
      <header className="mb-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
              Beneficios
            </p>
            <h1 className="mt-1.5 text-h1 tracking-tight text-foreground">
              Ofertas para ti
            </h1>
            <p className="mt-1 text-small text-muted-foreground">
              Lo de tus empresas favoritas primero. Todo canjeable con tu QR.
            </p>
          </div>
          <Button asChild variant="outline" className="shrink-0">
            <Link href="/cliente/explorar">
              <Compass className="mr-2 h-4 w-4" />
              Explorar empresas
            </Link>
          </Button>
        </div>
      </header>

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
            iconBg="bg-destructive/10"
            iconClass="fill-rose-500 text-destructive"
            titulo="Guardadas"
            count={guardadas.length}
            promociones={guardadas}
            guardadasIds={guardadasIds}
          />

          {/* Mis empresas: donde soy cliente + las que sigo */}
          <SeccionPromos
            icon={Star}
            iconBg="bg-warning/12"
            iconClass="fill-amber-400 text-warning-foreground"
            titulo="De tus empresas"
            descripcion="Donde eres cliente y las que sigues. Tus favoritas primero."
            count={feed.misEmpresas.length}
            promociones={feed.misEmpresas}
            guardadasIds={guardadasIds}
          />

          {/* Destacadas */}
          <SeccionPromos
            icon={Flame}
            iconBg="bg-warning/12"
            iconClass="text-warning-foreground"
            titulo="Destacadas"
            count={feed.destacadas.length}
            promociones={feed.destacadas}
            guardadasIds={guardadasIds}
          />

          {/* Nuevas */}
          <SeccionPromos
            icon={Sparkles}
            iconBg="bg-primary/10"
            iconClass="text-primary"
            titulo="Nuevas"
            descripcion="Publicadas en los últimos 14 días."
            count={feed.nuevas.length}
            promociones={feed.nuevas}
            guardadasIds={guardadasIds}
          />

          {/* Expiran pronto */}
          <SeccionPromos
            icon={Clock}
            iconBg="bg-destructive/10"
            iconClass="text-destructive"
            titulo="Expiran pronto"
            descripcion="Aprovéchalas antes de que venzan."
            count={feed.expiranPronto.length}
            promociones={feed.expiranPronto}
            guardadasIds={guardadasIds}
          />

          {/* Recomendadas */}
          <SeccionPromos
            icon={ThumbsUp}
            iconBg="bg-primary/10"
            iconClass="text-primary"
            titulo="Recomendadas para ti"
            descripcion="De empresas parecidas a las que sigues."
            count={feed.recomendadas.length}
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
            <section className="space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                    <Compass className="h-4.5 w-4.5 text-primary" />
                  </span>
                  <div>
                    <h2 className="text-base font-bold text-foreground">
                      Descubrir empresas
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      También podrían interesarte.
                    </p>
                  </div>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link href="/cliente/explorar">Ver todas</Link>
                </Button>
              </div>
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                {feed.empresasRecomendadas.map((c) => (
                  <CompanyCard key={c.id} company={c} hrefBase="/cliente/empresas" />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </main>
  )
}
