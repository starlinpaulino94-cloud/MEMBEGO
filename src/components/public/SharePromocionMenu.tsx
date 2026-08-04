'use client'

import { recordPromotionShare } from '@/modules/marketplace/actions'
import { landingUrlFor } from '@/lib/site'
import { rutaPublicaPromo } from '@/modules/promociones/slug'
import { ShareMenu } from './ShareMenu'

interface SharePromocionMenuProps {
  promocionId: string
  /** Dirección pública con nombre; sin ella se comparte el id de siempre. */
  slug?: string | null
  titulo: string
  companyName: string
  /**
   * Rompe-caché de la vista previa: pasa updatedAt (epoch ms). WhatsApp/FB
   * cachean la tarjeta POR URL; al editar la promo, la URL compartida cambia
   * (?v=) y los nuevos envíos muestran la tarjeta actualizada.
   */
  version?: number | null
}

/**
 * Fase E8 · Compartir una promoción (acción primaria) registrando el contador
 * de compartidas. Delega la UI en el menú genérico `ShareMenu`.
 */
export function SharePromocionMenu({
  promocionId,
  slug,
  titulo,
  companyName,
  version,
}: SharePromocionMenuProps) {
  return (
    <ShareMenu
      title={titulo}
      text={`${titulo} — promoción de ${companyName} en MembeGo.`}
      path={landingUrlFor(
        `${rutaPublicaPromo({ id: promocionId, slug })}${version ? `?v=${version}` : ''}`
      )}
      onShared={() => {
        recordPromotionShare(promocionId).catch(console.error)
      }}
    />
  )
}
