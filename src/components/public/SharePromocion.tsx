'use client'

import { recordPromotionShare } from '@/modules/marketplace/actions'
import { landingUrlFor } from '@/lib/site'
import { rutaPublicaPromo } from '@/modules/promociones/slug'
import { ShareButton } from './ShareButton'

interface SharePromocionProps {
  promocionId: string
  /** Dirección pública con nombre; sin ella se comparte el id de siempre. */
  slug?: string | null
  titulo: string
  companyName: string
}

/** Compartir una promoción registrando el contador de compartidas. */
export function SharePromocion({
  promocionId,
  slug,
  titulo,
  companyName,
}: SharePromocionProps) {
  return (
    <ShareButton
      title={titulo}
      text={`${titulo} — promoción de ${companyName} en MembeGo.`}
      path={landingUrlFor(rutaPublicaPromo({ id: promocionId, slug }))}
      onShared={() => {
        recordPromotionShare(promocionId).catch(console.error)
      }}
    />
  )
}
