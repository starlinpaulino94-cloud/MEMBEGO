import Link from 'next/link'
import { ArrowRight, Sparkles } from 'lucide-react'
import { HeroSection } from '@/components/public/HeroSection'
import { ValueProps } from '@/components/public/ValueProps'
import { HowItWorks } from '@/components/public/HowItWorks'
import { PromotionCard } from '@/components/public/PromotionCard'
import { getFeaturedPromotions, getPlatformStats } from '@/modules/marketplace/cached'

export const revalidate = 600

/**
 * Landing en modo MARCA ÚNICA: le habla al cliente de SU app de membresías y
 * beneficios, sin categorías ni lenguaje de "muchas empresas". El marketplace
 * (/empresas, /promociones) sigue existiendo por URL y crecerá cuando el
 * superadmin incorpore más empresas.
 */
export default async function HomePage() {
  const [stats, promotions] = await Promise.all([
    getPlatformStats(),
    getFeaturedPromotions(6),
  ])

  return (
    <>
      <HeroSection stats={stats} />
      <ValueProps />

      {/* Promociones vigentes */}
      {promotions.length > 0 && (
        <section className="bg-muted py-16 sm:py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mb-8">
              <h2 className="text-h1 text-foreground">
                Promociones del momento
              </h2>
              <p className="mt-2 text-muted-foreground">
                Ofertas y beneficios vigentes que no querrás perderte.
              </p>
            </div>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {promotions.map((p) => (
                <PromotionCard key={p.id} promotion={p} />
              ))}
            </div>
          </div>
        </section>
      )}

      <HowItWorks />

      {/* CTA final */}
      <section className="surface-hero py-16 text-center text-white">
        <div className="mx-auto max-w-2xl px-4">
          <Sparkles className="mx-auto h-10 w-10 text-primary" />
          <h2 className="mt-4 text-h1">
            Tu membresía te está esperando
          </h2>
          <p className="mt-3 text-white/80">
            Crea tu cuenta gratis, recibe tu código QR y empieza a disfrutar
            beneficios y promociones exclusivas hoy mismo.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link
              href="/registro"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-card px-6 py-3 font-semibold text-primary transition hover:bg-primary/10"
            >
              Crear mi cuenta gratis <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center justify-center rounded-xl border border-white/30 bg-white/10 px-6 py-3 font-semibold text-white backdrop-blur transition hover:bg-white/20"
            >
              Ya tengo cuenta
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}
