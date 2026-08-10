import Link from 'next/link'
import Image from 'next/image'
import {
  ArrowLeft,
  ArrowRight,
  MapPin,
  Mail,
  Phone,
  MessageCircle,
  Globe,
  Instagram,
  Facebook,
  Music2,
  Star,
  Gift,
  Users,
  Check,
  Crown,
  Sparkles,
  QrCode,
  BadgeCheck,
  CalendarDays,
  Newspaper,
  Clock,
} from 'lucide-react'
import { PromotionGrid } from '@/components/public/PromotionGrid'
import { FollowButton } from '@/components/public/FollowButton'
import { ShareButton } from '@/components/public/ShareButton'
import { ResenasSection } from '@/components/marketplace/ResenasSection'
import type { CompanyResenas } from '@/modules/resenas/queries'
import type {
  CompanyPublic,
  CompanyStats,
  PromotionPublic,
} from '@/modules/marketplace/types'
import type { PlanPublic, CompanyPostsPublic, SucursalPublic } from '@/modules/marketplace/queries'
import type { CtaPlanes } from '@/modules/marketplace/conversion'
import type { RegionalPrefs } from '@/lib/format'
import { formatMoney } from '@/lib/format'
import { landingUrlFor } from '@/lib/site'
import { SucursalesSection } from './SucursalesSection'

const TIPO_LABEL: Record<string, string> = {
  carwash: 'Car Wash',
  restaurante: 'Restaurante',
  gimnasio: 'Gimnasio',
  salon: 'Salón',
}

export interface CompanyProfileProps {
  /**
   * 'public' = perfil dentro de la Landing (visitantes, CTAs de registro).
   * 'app'    = perfil interno dentro de la aplicación autenticada; la
   *            navegación nunca sale al sitio público.
   */
  mode: 'public' | 'app'
  company: CompanyPublic
  stats: CompanyStats | null
  planes: PlanPublic[]
  promotions: PromotionPublic[]
  posts: CompanyPostsPublic
  prefs: RegionalPrefs | null
  /**
   * Solo en modo 'app': ruta interna para elegir/cambiar plan cuando esta es la
   * empresa del usuario (p. ej. '/cliente/planes'). Si es null, los planes se
   * muestran como información (sin CTA de compra), evitando salir a la Landing.
   */
  planesHref?: string | null
  /** Reseñas de clientes (promedio + opiniones). null/ausente = sin sección. */
  resenas?: CompanyResenas | null
  /** Formulario "Escribe tu reseña" (solo si el visitante puede opinar). */
  resenaFormSlot?: React.ReactNode

  // ── Fase 4 · detalle sucursal-consciente (conversión desde el mapa) ─────────
  /** Sucursales públicas de la empresa (activas, visibles en el mapa). */
  sucursales?: SucursalPublic[]
  /** Sucursal activa (viene de `?sucursal=` en el mapa). Su ficha se resalta. */
  sucursalActiva?: SucursalPublic | null
  /** CTA de la sección de planes resuelto por elegibilidad (null = informativo). */
  planesCta?: CtaPlanes | null
  /** Ruta de regreso del detalle de promoción (se añade como `?retorno=`). */
  promoRetorno?: string
  /** Sobrescribe el botón volver (p. ej. "Cerca de mí" cuando vino del mapa). */
  backHref?: string
  backLabel?: string
}

export function CompanyProfile({
  mode,
  company,
  stats,
  planes,
  promotions,
  posts,
  prefs,
  planesHref = null,
  resenas = null,
  resenaFormSlot,
  sucursales,
  sucursalActiva,
  planesCta,
  promoRetorno,
  backHref,
  backLabel,
}: CompanyProfileProps) {
  const hayResenas = !!resenas && (resenas.total > 0 || !!resenaFormSlot)
  const isApp = mode === 'app'

  // Rutas dependientes del contexto. En 'app' todo permanece dentro de la
  // aplicación; en 'public' se usan las rutas de la Landing. Fase 4: si el
  // visitante vino del mapa (`backHref`/`backLabel`), volver lleva al mapa.
  const backHrefFinal = backHref ?? (isApp ? '/cliente/empresas' : '/empresas')
  const backLabelFinal = backLabel ?? 'Empresas'
  const discoverHref = isApp ? '/cliente/explorar' : '/empresas'
  const promoHrefBase = isApp ? '/cliente/promociones' : '/promocion'
  const registroHref = `/registro/${company.slug}`
  // La URL para compartir siempre es la pública, en el dominio de la landing
  // (para que el destinatario, que puede no tener sesión, la pueda abrir).
  const sharePath = `/empresas/${company.slug}`
  const shareUrl = landingUrlFor(sharePath)
  const followRedirect = isApp
    ? `/cliente/empresas/${company.slug}`
    : sharePath

  // Navegación por secciones (solo las que tienen contenido).
  const seccionesNav = [
    sucursales && sucursales.length > 0 && { id: 'sucursales', label: 'Sucursales' },
    planes.length > 0 && { id: 'membresias', label: 'Membresías' },
    promotions.length > 0 && { id: 'promociones', label: 'Promociones' },
    posts.beneficios.length > 0 && { id: 'beneficios', label: 'Beneficios' },
    posts.eventos.length > 0 && { id: 'eventos', label: 'Eventos' },
    posts.noticias.length > 0 && { id: 'noticias', label: 'Noticias' },
    company.galleryImages.length > 0 && { id: 'galeria', label: 'Galería' },
    hayResenas && { id: 'resenas', label: 'Reseñas' },
    { id: 'informacion', label: 'Información' },
  ].filter(Boolean) as { id: string; label: string }[]

  const initials = company.name.slice(0, 2).toUpperCase()
  const location = [company.ciudad, company.provincia, company.pais]
    .filter(Boolean)
    .join(', ')

  const contactLinks = [
    company.email && { icon: Mail, label: company.email, href: `mailto:${company.email}` },
    company.telefono && { icon: Phone, label: company.telefono, href: `tel:${company.telefono}` },
    company.whatsapp && {
      icon: MessageCircle,
      label: 'WhatsApp',
      href: `https://wa.me/${company.whatsapp.replace(/\D/g, '')}`,
    },
    company.website && { icon: Globe, label: 'Sitio web', href: company.website },
  ].filter(Boolean) as { icon: typeof Mail; label: string; href: string }[]

  const socialLinks = [
    company.instagram && { icon: Instagram, label: 'Instagram', href: company.instagram },
    company.facebook && { icon: Facebook, label: 'Facebook', href: company.facebook },
    company.tiktok && { icon: Music2, label: 'TikTok', href: company.tiktok },
  ].filter(Boolean) as { icon: typeof Mail; label: string; href: string }[]

  return (
    <div className={isApp ? 'bg-card' : 'min-h-screen bg-card'}>
      {/* Hero / Banner */}
      <section className="relative h-56 w-full overflow-hidden bg-gradient-to-br from-emerald-950 via-slate-900 to-slate-950 sm:h-72">
        {company.bannerUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={company.bannerUrl}
              alt=""
              className="h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-900/70 via-slate-900/20 to-transparent" />
          </>
        ) : (
          <>
            <div className="absolute inset-0 bg-grid-light mask-fade" />
            <div className="absolute -top-10 right-16 h-56 w-56 rounded-full bg-primary/25 blur-3xl" />
          </>
        )}
        <div className="absolute left-0 top-0 p-4 sm:p-6">
          <Link
            href={backHrefFinal}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/15 px-3.5 py-1.5 text-sm font-medium text-white backdrop-blur transition-colors hover:bg-white/25"
          >
            <ArrowLeft className="h-4 w-4" /> {backLabelFinal}
          </Link>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        {/* Header card */}
        <div className="relative -mt-16 animate-slide-up rounded-3xl border border-border/80 bg-card p-6 shadow-premium-lg sm:p-8">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
            {/* Logo */}
            <div className="-mt-16 shrink-0 sm:-mt-20">
              {company.logoUrl ? (
                <div className="relative h-28 w-28 overflow-hidden rounded-2xl border-4 border-white bg-card shadow-md sm:h-32 sm:w-32">
                  <Image src={company.logoUrl} alt={company.name} fill className="object-cover" />
                </div>
              ) : (
                <div className="flex h-28 w-28 items-center justify-center rounded-2xl border-4 border-white bg-gradient-to-br from-primary to-teal-500 text-3xl font-bold text-white shadow-md sm:h-32 sm:w-32">
                  {initials}
                </div>
              )}
            </div>

            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-info/10 px-2.5 py-0.5 text-xs font-semibold text-info">
                  {TIPO_LABEL[company.type] ?? company.type}
                </span>
                {company.isFeatured && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2.5 py-0.5 text-xs font-semibold text-warning">
                    <Star className="h-3 w-3 fill-amber-500 text-warning" /> Destacada
                  </span>
                )}
              </div>

              <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
                {company.name}
              </h1>

              {(location || company.horario) && (
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  {location && (
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="h-4 w-4" /> {location}
                    </span>
                  )}
                  {company.horario && (
                    <span className="inline-flex items-center gap-1.5">
                      <Clock className="h-4 w-4" /> {company.horario}
                    </span>
                  )}
                </div>
              )}

              {company.description && (
                <p className="mt-3 max-w-2xl text-muted-foreground">{company.description}</p>
              )}

              {/* Chips de datos reales (solo si aportan) */}
              <div className="mt-4 flex flex-wrap gap-2">
                {stats && stats.activePromotions > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-3 py-1 text-sm font-medium text-destructive">
                    <Gift className="h-4 w-4" /> {stats.activePromotions} promociones
                  </span>
                )}
                {stats && stats.totalMembers > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-info/10 px-3 py-1 text-sm font-medium text-info">
                    <Users className="h-4 w-4" /> {stats.totalMembers} miembros
                  </span>
                )}
                {stats && stats.averageRating != null && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/15 px-3 py-1 text-sm font-medium text-warning">
                    <Star className="h-4 w-4 fill-amber-500 text-warning" />
                    {stats.averageRating.toFixed(1)}
                    <span className="text-warning/70">({stats.totalRatings})</span>
                  </span>
                )}
              </div>
            </div>

            {/* CTA */}
            <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto">
              {isApp ? (
                (planesCta?.href || planesHref) && (
                  <Link
                    href={planesCta?.href ?? planesHref!}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground shadow-sm transition hover:bg-primary sm:w-auto"
                  >
                    {planesCta?.label ?? 'Ver planes'} <ArrowRight className="h-4 w-4" />
                  </Link>
                )
              ) : (
                <Link
                  href={registroHref}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground shadow-sm transition hover:bg-primary sm:w-auto"
                >
                  Quiero una membresía <ArrowRight className="h-4 w-4" />
                </Link>
              )}
              <FollowButton companyId={company.id} redirectTo={followRedirect} />
              <ShareButton
                title={company.name}
                text={`Descubre ${company.name} en MembeGo: membresías, promociones y beneficios.`}
                path={shareUrl}
              />
            </div>
          </div>

          {/* Contacto y redes */}
          {(contactLinks.length > 0 || socialLinks.length > 0) && (
            <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 border-t border-border/60 pt-5">
              {contactLinks.map((c) => (
                <a
                  key={c.label}
                  href={c.href}
                  target={c.href.startsWith('http') ? '_blank' : undefined}
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-primary"
                >
                  <c.icon className="h-4 w-4" /> {c.label}
                </a>
              ))}
              {socialLinks.map((s) => (
                <a
                  key={s.label}
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-primary"
                >
                  <s.icon className="h-4 w-4" /> {s.label}
                </a>
              ))}
            </div>
          )}
        </div>

        {/* Sucursales: la ficha resaltada es la que eligió el usuario en el mapa. */}
        {sucursales && sucursales.length > 0 && (
          <div className="mt-10">
            <SucursalesSection sucursales={sucursales} sucursalActiva={sucursalActiva ?? null} />
          </div>
        )}

        {/* Navegación de secciones (mini web) */}
        {seccionesNav.length > 1 && (
          <nav className="sticky top-16 z-30 mt-6 -mx-4 overflow-x-auto border-b border-border bg-white/90 px-4 backdrop-blur sm:mx-0 sm:rounded-full sm:border sm:px-2">
            <div className="flex gap-1 py-2">
              {seccionesNav.map((s) => (
                <a
                  key={s.id}
                  href={`#${s.id}`}
                  className="whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium text-muted-foreground transition hover:bg-primary/10 hover:text-primary"
                >
                  {s.label}
                </a>
              ))}
            </div>
          </nav>
        )}

        {/* Planes */}
        {planes.length > 0 && (
          <section id="membresias" className="mt-14 scroll-mt-32">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                Planes de membresía
              </h2>
              <p className="mt-2 text-muted-foreground">
                Elige el plan que mejor se adapte a ti y recibe tu membresía
                digital con QR.
              </p>
              {sucursalActiva && (
                <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-success/10 px-3 py-1 text-xs font-medium text-success">
                  <Check className="h-3.5 w-3.5" /> Canjeable en {sucursalActiva.nombre}
                </p>
              )}
            </div>

            <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {planes.map((plan, i) => {
                const featured = planes.length > 1 && i === Math.floor(planes.length / 2)
                // CTA del plan según contexto: público -> registro; app -> plan
                // interno (solo si es la empresa del usuario), si no, sin CTA.
                // Fase 4: si faltan requisitos, el CTA resuelve primero el paso
                // (vehículo) y regresa al detalle; se muestra igual en cada plan.
                const planCtaHref = isApp ? (planesCta?.href ?? planesHref) : registroHref
                const planCtaLabel = planesCta?.label ?? 'Elegir plan'
                return (
                  <div
                    key={plan.id}
                    className={`card-interactive relative flex flex-col rounded-3xl border bg-card p-6 ${
                      featured
                        ? 'border-primary/40 shadow-premium ring-1 ring-info/30'
                        : 'border-border/80 shadow-card'
                    }`}
                  >
                    {featured && (
                      <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3.5 py-1 text-xs font-semibold text-primary-foreground shadow-glow">
                        Más popular
                      </span>
                    )}

                    <div className="flex items-center gap-2">
                      {plan.esIlimitado ? (
                        <Crown className="h-5 w-5 text-warning" />
                      ) : (
                        <Sparkles className="h-5 w-5 text-primary" />
                      )}
                      <h3 className="font-semibold text-foreground">{plan.nombre}</h3>
                      {plan.esIlimitado && (
                        <span className="ml-auto rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning">
                          Ilimitado
                        </span>
                      )}
                    </div>

                    <p className="mt-4 text-3xl font-extrabold text-foreground">
                      {formatMoney(plan.precio, prefs)}
                      <span className="text-base font-normal text-muted-foreground">/mes</span>
                    </p>
                    {plan.descripcion && (
                      <p className="mt-2 text-sm text-muted-foreground">{plan.descripcion}</p>
                    )}

                    <div className="mt-4 rounded-lg bg-muted p-3 text-sm">
                      <p className="font-medium text-foreground">
                        {plan.esIlimitado
                          ? 'Usos ilimitados'
                          : `${plan.lavadosIncluidos} usos incluidos`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Vigencia: {plan.vigenciaDias} días
                      </p>
                    </div>

                    {plan.beneficios.length > 0 && (
                      <ul className="mt-4 space-y-2">
                        {plan.beneficios.map((b) => (
                          <li key={b} className="flex items-start gap-2 text-sm text-muted-foreground">
                            <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                            {b}
                          </li>
                        ))}
                      </ul>
                    )}

                    {planCtaHref && (
                      <Link
                        href={planCtaHref}
                        className={`mt-6 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-semibold transition ${
                          featured
                            ? 'bg-primary text-primary-foreground hover:bg-primary'
                            : 'bg-muted text-foreground hover:bg-muted'
                        }`}
                        >
                          {planCtaLabel} <ArrowRight className="h-4 w-4" />
                        </Link>
                    )}

                    {/* Fase E8: página pública y compartible del plan */}
                    <Link
                      href={`/plan/${plan.id}`}
                      className="mt-2 inline-flex items-center justify-center gap-1.5 text-sm font-medium text-primary hover:underline"
                    >
                      Ver y compartir plan <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* Promociones */}
        {promotions && promotions.length > 0 && (
          <section id="promociones" className="mt-14 scroll-mt-32">
            <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              Promociones vigentes
            </h2>
            <p className="mt-2 text-muted-foreground">
              Beneficios exclusivos disponibles ahora mismo.
            </p>
            {sucursalActiva && (
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-success/10 px-3 py-1 text-xs font-medium text-success">
                <Check className="h-3.5 w-3.5" /> Canjeable en {sucursalActiva.nombre}
              </p>
            )}
            <div className="mt-6">
              <PromotionGrid
                promotions={promotions}
                isLoading={false}
                variant="default"
                hrefBase={promoHrefBase}
                exploreHref={discoverHref}
                retorno={promoRetorno}
              />
            </div>
          </section>
        )}

        {/* Beneficios para miembros */}
        {posts.beneficios.length > 0 && (
          <section id="beneficios" className="mt-14 scroll-mt-32">
            <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              Beneficios para miembros
            </h2>
            <p className="mt-2 text-muted-foreground">
              Ventajas permanentes por ser miembro de {company.name}.
            </p>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {posts.beneficios.map((b) => (
                <div
                  key={b.id}
                  className="rounded-2xl border border-success/20 bg-success/10 p-5"
                >
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-2.5 py-0.5 text-xs font-semibold text-success">
                    <BadgeCheck className="h-3.5 w-3.5" /> Beneficio
                  </span>
                  <h3 className="mt-3 font-semibold text-foreground">{b.titulo}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{b.contenido}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Eventos */}
        {posts.eventos.length > 0 && (
          <section id="eventos" className="mt-14 scroll-mt-32">
            <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              Próximos eventos
            </h2>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {posts.eventos.map((e) => (
                <div
                  key={e.id}
                  className="flex gap-4 rounded-2xl border border-border bg-card p-5"
                >
                  <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <span className="text-lg font-bold leading-none">
                      {e.fechaEvento ? new Date(e.fechaEvento).getDate() : '—'}
                    </span>
                    <span className="text-[10px] font-semibold uppercase">
                      {e.fechaEvento
                        ? new Intl.DateTimeFormat('es-DO', { timeZone: 'America/Santo_Domingo', month: 'short' }).format(
                            new Date(e.fechaEvento)
                          )
                        : ''}
                    </span>
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">{e.titulo}</h3>
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                      {e.contenido}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {e.fechaEvento && (
                        <span className="inline-flex items-center gap-1">
                          <CalendarDays className="h-3.5 w-3.5" />
                          {new Intl.DateTimeFormat('es-DO', { timeZone: 'America/Santo_Domingo',
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          }).format(new Date(e.fechaEvento))}
                        </span>
                      )}
                      {e.lugar && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5" /> {e.lugar}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Noticias */}
        {posts.noticias.length > 0 && (
          <section id="noticias" className="mt-14 scroll-mt-32">
            <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              Noticias
            </h2>
            <div className="mt-6 space-y-4">
              {posts.noticias.map((n) => (
                <article
                  key={n.id}
                  className="rounded-2xl border border-border bg-card p-5"
                >
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Newspaper className="h-3.5 w-3.5" />
                    {new Intl.DateTimeFormat('es-DO', { timeZone: 'America/Santo_Domingo', dateStyle: 'long' }).format(
                      new Date(n.publicadaEn)
                    )}
                  </div>
                  <h3 className="mt-2 font-semibold text-foreground">{n.titulo}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{n.contenido}</p>
                </article>
              ))}
            </div>
          </section>
        )}

        {/* Galería */}
        {company.galleryImages && company.galleryImages.length > 0 && (
          <section id="galeria" className="mt-14 scroll-mt-32">
            <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              Galería
            </h2>
            <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {company.galleryImages.map((image, idx) => (
                <div
                  key={idx}
                  className="relative aspect-square w-full overflow-hidden rounded-xl bg-muted"
                >
                  <Image
                    src={image}
                    alt={`${company.name} - ${idx + 1}`}
                    fill
                    className="object-cover transition-transform duration-300 hover:scale-105"
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Reseñas de clientes */}
        {hayResenas && resenas && (
          <section id="resenas" className="mt-14 scroll-mt-32">
            <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              Reseñas
            </h2>
            <div className="mt-6">
              <ResenasSection resenas={resenas} formSlot={resenaFormSlot} />
            </div>
          </section>
        )}

        {/* Información */}
        <section id="informacion" className="mt-14 scroll-mt-32">
          <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Información
          </h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {company.horario && (
              <div className="rounded-2xl border border-border bg-card p-5">
                <h3 className="flex items-center gap-2 font-semibold text-foreground">
                  <Clock className="h-4 w-4 text-primary" /> Horario de atención
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">{company.horario}</p>
              </div>
            )}
            {location && (
              <div className="rounded-2xl border border-border bg-card p-5">
                <h3 className="flex items-center gap-2 font-semibold text-foreground">
                  <MapPin className="h-4 w-4 text-primary" /> Ubicación
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">{location}</p>
                {company.googleMapsUrl && (
                  <a
                    href={company.googleMapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-primary transition hover:bg-muted"
                  >
                    Ver en Google Maps
                  </a>
                )}
              </div>
            )}
            {contactLinks.length > 0 && (
              <div className="rounded-2xl border border-border bg-card p-5">
                <h3 className="flex items-center gap-2 font-semibold text-foreground">
                  <Phone className="h-4 w-4 text-primary" /> Contacto
                </h3>
                <div className="mt-2 space-y-2">
                  {contactLinks.map((c) => (
                    <a
                      key={c.label}
                      href={c.href}
                      target={c.href.startsWith('http') ? '_blank' : undefined}
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-sm text-muted-foreground transition hover:text-primary"
                    >
                      <c.icon className="h-4 w-4" /> {c.label}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* CTA final */}
      {isApp ? (
        <section className="mt-16 rounded-3xl bg-gradient-to-br from-blue-700 to-indigo-800 py-14 text-center text-white">
          <div className="mx-auto max-w-2xl px-4">
            <Sparkles className="mx-auto h-10 w-10 text-white" />
            <h2 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
              ¿Te gusta {company.name}?
            </h2>
            <p className="mt-3 text-white/80">
              Síguela para recibir sus promociones y novedades, o descubre más
              empresas dentro de MembeGo.
            </p>
            <div className="mt-8 flex justify-center">
              <Link
                href={discoverHref}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-card px-6 py-3 font-semibold text-primary transition hover:bg-primary/10"
              >
                Descubrir empresas <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </section>
      ) : (
        <section className="mt-16 bg-gradient-to-br from-blue-700 to-indigo-800 py-14 text-center text-white">
          <div className="mx-auto max-w-2xl px-4">
            <QrCode className="mx-auto h-10 w-10 text-primary" />
            <h2 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
              Activa tu membresía en {company.name}
            </h2>
            <p className="mt-3 text-white/80">
              Regístrate, elige tu plan y recibe tu membresía digital con QR en
              minutos.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link
                href={registroHref}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-card px-6 py-3 font-semibold text-primary transition hover:bg-primary/10"
              >
                Registrarme <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href={discoverHref}
                className="inline-flex items-center justify-center rounded-xl border border-white/30 bg-white/10 px-6 py-3 font-semibold text-white backdrop-blur transition hover:bg-white/20"
              >
                Ver otras empresas
              </Link>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
