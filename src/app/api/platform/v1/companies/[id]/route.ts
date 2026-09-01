import type { NextRequest } from 'next/server'
import { conEmpresa } from '@/lib/tenant'
import { autenticarSobreEmpresa, esFallo } from '@/modules/plataforma/api'
import { companyDTO } from '@/modules/plataforma/dto'
import { errorApi, respuestaApi } from '@/modules/plataforma/errores'

export const dynamic = 'force-dynamic'

/**
 * GET /api/platform/v1/companies/{id} — cabecera, moneda, zona horaria, idioma.
 *
 * Sin esto un satélite no puede imprimir un comprobante ni formatear un importe.
 *
 * Sin scope propio: la habilitación ES la autorización. Un sistema que puede
 * operar para una empresa evidentemente puede saber cómo se llama y en qué
 * moneda cobra; un `companies:read` que todo manifest incluiría siempre no
 * decide nada y solo alarga la revisión.
 *
 * `conEmpresa` y no `sinEmpresa`: la empresa ya está verificada contra las
 * habilitaciones, así que la consulta puede —y debe— ir con su contexto puesto.
 * Con RLS Capa 2 encendida, un `id` que no fuera el autorizado devolvería cero
 * filas incluso si esta ruta se equivocara. Dos cierres independientes.
 */
export async function GET(req: NextRequest, ctxRuta: { params: Promise<{ id: string }> }) {
  const { id } = await ctxRuta.params
  const auth = await autenticarSobreEmpresa(
    req, null, id,
    // Lectura: se abre a CLAVES DE API DE EMPRESA (Connect · F3/F8).
    { claveDeEmpresa: true }
  )
  if (esFallo(auth)) return auth.fallo

  const empresa = await conEmpresa(auth.companyId, (tx) =>
    tx.company.findUnique({
      where: { id: auth.companyId },
      select: {
        id: true,
        name: true,
        slug: true,
        logoUrl: true,
        moneda: true,
        zonaHoraria: true,
        idioma: true,
      },
    })
  ).catch(() => null)

  if (!empresa) return errorApi('NOT_FOUND', auth.ctx.requestId)
  return respuestaApi(companyDTO(empresa), auth.ctx.requestId)
}
