import 'server-only'

import { unstable_cache } from 'next/cache'
import { conEmpresa } from '@/lib/tenant'
import { resolverUmbrales, type UmbralesRetencion } from '@/modules/riesgo/semaforo'

/**
 * Umbrales del semáforo, por empresa. Cacheados 5 minutos: los lee cada tabla
 * de clientes y cada ejecución de las automatizaciones, y cambian una vez al
 * año como mucho.
 *
 * FAIL-OPEN: si la columna todavía no está migrada o la base falla, se
 * devuelven los valores por defecto. Un semáforo con los umbrales estándar es
 * útil; una pantalla que no carga porque falta una columna de configuración, no.
 */
export const UMBRALES_TAG = 'retencion-umbrales'

export const getUmbralesRetencion = unstable_cache(
  async (companyId: string): Promise<UmbralesRetencion> => {
    try {
      const empresa = await conEmpresa(companyId, (tx) =>
        tx.company.findUnique({
          where: { id: companyId },
          select: { retencionConfig: true },
        })
      )
      return resolverUmbrales(empresa?.retencionConfig ?? null)
    } catch (e) {
      console.error('[retencion/umbrales]', e)
      return resolverUmbrales(null)
    }
  },
  ['retencion-umbrales'],
  { revalidate: 300, tags: [UMBRALES_TAG] }
)
