import 'server-only'
import { cache } from 'react'
import { conEmpresa } from '@/lib/tenant'
import type { RegionalPrefs } from '@/lib/format'

/**
 * Prefs regionales (moneda/idioma/zonaHoraria) de una empresa, para formatear
 * dinero y fechas con `formatMoney`/`formatDate` (src/lib/format.ts).
 *
 * Cacheado por request con React.cache: si varios bloques de la misma página
 * lo piden, la query a Company se hace una sola vez.
 *
 * Si `companyId` es null/undefined o no corresponde a una empresa (p. ej.
 * superadmin viendo el panel de todas, o el centinela '__none__'), devuelve
 * null → los helpers caen al default de plataforma (DOP / es-DO), que es el
 * comportamiento correcto para contextos sin una empresa única.
 */
export const getRegionalPrefs = cache(
  async (companyId: string | null | undefined): Promise<RegionalPrefs | null> => {
    if (!companyId || companyId === '__none__') return null
    try {
      return await conEmpresa(companyId, (tx) =>
        tx.company.findUnique({
          where: { id: companyId },
          select: { moneda: true, idioma: true, zonaHoraria: true },
        })
      )
    } catch {
      return null
    }
  }
)
