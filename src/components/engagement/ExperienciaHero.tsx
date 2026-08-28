'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import type { ExperienciaHero as Experiencia } from '@/modules/experience/engine'
import { FlashPromotion } from '@/components/ui/flash-promotion'
import { PromoBanner } from '@/components/ui/promo-banner'
import { Shine } from '@/components/ui/shine'
import { Button } from '@/components/ui/button'
import { CampanaBanner } from '@/components/engagement/CampanaBanner'

/**
 * MEE · Renderer del motor de experiencias: traduce la decisión de
 * `elegirExperiencias` a la pieza visual correspondiente (MMS):
 *
 *  - CAMPANA → banner con el branding propio de la campaña (CampanaBanner).
 *  - ALTA    → FlashPromotion: countdown, barra de tiempo que se agota, glow
 *              que respira, shine y CTA pulsante (estilo Temu).
 *  - MEDIA   → PromoBanner hero con barrido de Shine y CTA glass.
 *  - BAJA    → PromoBanner estándar (celebración sin estridencia).
 */
export function ExperienciaHero({ exp }: { exp: Experiencia }) {
  const router = useRouter()

  if (exp.tipo === 'CAMPANA') {
    return <CampanaBanner exp={exp} />
  }

  if (exp.urgencia === 'alta' && exp.hasta) {
    return (
      <div className="mb-6" data-experiencia={exp.tipo}>
        <FlashPromotion
          eyebrow={exp.eyebrow}
          titulo={exp.titulo}
          descripcion={exp.descripcion}
          hasta={exp.hasta}
          ctaLabel={exp.ctaTexto}
          onCta={() => router.push(exp.ctaHref)}
          tono={exp.tono}
        />
      </div>
    )
  }

  return (
    <div
      className={exp.urgencia === 'media' ? 'animate-scale-in mb-6' : 'animate-fade-up mb-6'}
      data-experiencia={exp.tipo}
    >
      <Shine modo="loop" className="block rounded-2xl">
        <PromoBanner
          tono={exp.tono}
          size={exp.urgencia === 'media' ? 'hero' : 'base'}
          eyebrow={exp.eyebrow}
          titulo={exp.titulo}
          descripcion={exp.descripcion}
        >
          <Button
            asChild
            size={exp.urgencia === 'media' ? 'xl' : 'lg'}
            variant="glass"
            className="w-full font-bold text-white sm:w-auto"
          >
            <Link href={exp.ctaHref}>
              {exp.ctaTexto}
              <ArrowRight className="ml-1 h-4 w-4" aria-hidden />
            </Link>
          </Button>
        </PromoBanner>
      </Shine>
    </div>
  )
}
