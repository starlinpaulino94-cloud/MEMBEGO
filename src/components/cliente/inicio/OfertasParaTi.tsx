import { Sparkles, Clock, Store } from 'lucide-react'
import { Carrusel, CarruselItem } from '@/components/engagement/Carrusel'
import { PromotionCard } from '@/components/public/PromotionCard'
import type { PromoFeed } from '@/modules/social/queries'

/**
 * Ofertas del Home del cliente, en carriles horizontales.
 *
 * Reparte el feed que ya existe (`getPromoFeed`) en tres carriles con una
 * intención distinta cada uno, y NO repite promociones entre ellos — el propio
 * feed ya viene sin duplicados.
 *
 * Se muestran como máximo DOS carriles. El Home no es un catálogo: tres filas
 * de ofertas más la wallet más las novedades convierten el inicio en una lista
 * infinita, que es justo lo que el rediseño quiere evitar. El resto vive en
 * Ofertas, a un toque de "Ver todo".
 *
 * El orden de prioridad responde a qué es más accionable: lo que caduca
 * pronto (urgencia real) → lo de tus negocios (relevancia) → lo nuevo.
 */
export function OfertasParaTi({ feed }: { feed: PromoFeed }) {
  const carriles = [
    {
      clave: 'expiran',
      icon: Clock,
      iconClass: 'text-warning',
      titulo: 'Aprovecha antes de que venza',
      subtitulo: 'Termina esta semana',
      items: feed.expiranPronto,
    },
    {
      clave: 'mias',
      icon: Store,
      iconClass: 'text-primary',
      titulo: 'De tus negocios',
      subtitulo: 'Donde ya eres cliente',
      items: feed.misEmpresas,
    },
    {
      clave: 'recomendadas',
      icon: Sparkles,
      iconClass: 'text-primary',
      titulo: 'Podría interesarte',
      subtitulo: 'De negocios que aún no sigues',
      items: feed.recomendadas,
    },
    {
      clave: 'nuevas',
      icon: Sparkles,
      iconClass: 'text-primary',
      titulo: 'Nuevas para ti',
      subtitulo: 'Publicadas hace poco',
      items: feed.nuevas.length > 0 ? feed.nuevas : feed.destacadas,
    },
  ]
    .filter((c) => c.items.length > 0)
    .slice(0, 2)

  if (carriles.length === 0) return null

  return (
    <div className="space-y-8">
      {carriles.map((c) => (
        <Carrusel
          key={c.clave}
          icon={c.icon}
          iconClass={c.iconClass}
          titulo={c.titulo}
          subtitulo={c.subtitulo}
          verTodoHref="/cliente/promociones"
        >
          {c.items.slice(0, 8).map((p) => (
            <CarruselItem key={p.id}>
              <PromotionCard
                promotion={p}
                variant="compact"
                retorno="/cliente/inicio"
              />
            </CarruselItem>
          ))}
        </Carrusel>
      ))}
    </div>
  )
}
