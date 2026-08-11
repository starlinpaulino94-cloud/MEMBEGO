import type { NextRequest } from 'next/server'
import { autenticarSobreEmpresa, esFallo } from '@/modules/plataforma/api'
import { MAX_BUSQUEDA, MINIMO_BUSQUEDA, buscarClientes } from '@/modules/plataforma/consultas'
import { errorApi, respuestaApi } from '@/modules/plataforma/errores'

export const dynamic = 'force-dynamic'

/**
 * GET /api/platform/v1/customers/search?companyId=…&q=…
 *
 * BUSCA por texto parcial en nombre, teléfono o correo. Es lo que necesita un
 * mostrador: el empleado teclea «mar» y espera ver a María.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTÁ SEPARADO DE `resolve`
 *
 * `resolve` exige un identificador EXACTO y devuelve como mucho uno. Ese límite
 * era deliberado: sin él, la API se convierte en una forma de descargarse la
 * base de clientes de una empresa a base de probar.
 *
 * Pero un mostrador no puede operar solo con identificadores exactos, y el
 * ejercicio de meter a Car Wash por el contrato lo dejó claro. Así que la
 * búsqueda existe con las dos barreras que la separan de un listado:
 *
 *   · mínimo de caracteres — con uno, «buscar» es «dame todos los que empiezan
 *     por a», y repitiendo el abecedario se tiene la base entera;
 *   · tope de resultados — el que busca a alguien concreto lo encuentra en los
 *     primeros; el que está descargando la base se queda sin ver el final.
 *
 * Ninguna de las dos hace imposible el abuso; las dos lo hacen caro y visible
 * en el registro de peticiones, que es lo que se puede conseguir de verdad.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const auth = await autenticarSobreEmpresa(req, 'customers:read', params.get('companyId'))
  if (esFallo(auth)) return auth.fallo

  const q = params.get('q')?.trim() ?? ''
  if (q.length < MINIMO_BUSQUEDA) {
    return errorApi('INVALID_REQUEST', auth.ctx.requestId, {
      message: `q must be at least ${MINIMO_BUSQUEDA} characters.`,
    })
  }

  const customers = await buscarClientes(auth.companyId, q)
  return respuestaApi({ customers, limit: MAX_BUSQUEDA }, auth.ctx.requestId)
}
