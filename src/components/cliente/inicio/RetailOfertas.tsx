import { OfertasParaTi } from './OfertasParaTi'
import type { PromoFeed } from '@/modules/social/queries'

/**
 * Las ofertas personalizadas, en la retícula retail.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CUÁNDO SE VE, Y POR QUÉ NO SIEMPRE
 *
 * Esto NO es el bloque «Empresas destacadas» de la composición. Aquel lo
 * publica la empresa; este sale del feed de esta persona (sus negocios, lo que
 * le vence pronto, lo que aún no sigue).
 *
 * Cuando la empresa ya publicó su composición, la mitad comercial del Inicio
 * es suya y esto sobra: dos carriles de promociones seguidos son la misma
 * pantalla dicha dos veces. Por eso el Inicio lo enseña solo cuando NO hay
 * composición publicada — así nadie se queda sin nada que descubrir, y nadie
 * ve lo mismo repetido.
 */
export function RetailOfertas({ feed }: { feed: PromoFeed }) {
  return (
    <section className="bg-muted px-4 py-5 md:px-6 md:py-6" aria-label="Ofertas para ti">
      <div className="mx-auto max-w-6xl">
        <OfertasParaTi feed={feed} />
      </div>
    </section>
  )
}
