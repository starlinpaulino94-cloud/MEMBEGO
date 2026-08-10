import type { NextRequest } from 'next/server'
import { autenticarSobreEmpresa, esFallo } from '@/modules/plataforma/api'
import { vehiculoPorPlaca } from '@/modules/plataforma/consultas'
import { errorApi, respuestaApi } from '@/modules/plataforma/errores'

export const dynamic = 'force-dynamic'

/**
 * GET /api/platform/v1/vehicles/by-plate?companyId=…&plate=…
 *
 * El vehículo de una matrícula. Es la consulta que hace una pista cuando entra
 * un coche: el encargado no pregunta «¿cómo se llama?», mira la placa.
 *
 * Devuelve 404 cuando no está, y eso NO es un error de integración: que entre
 * un coche que nunca vino es el caso normal de cualquier lavadero. El SDK lo
 * traduce a `null` justamente por eso — obligar a envolver en `try` la
 * operación más frecuente del día sería un contrato mal pensado.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const auth = await autenticarSobreEmpresa(req, 'customers:read', params.get('companyId'))
  if (esFallo(auth)) return auth.fallo

  const plate = params.get('plate')?.trim() ?? ''
  if (!plate) {
    return errorApi('INVALID_REQUEST', auth.ctx.requestId, { message: 'plate is required.' })
  }

  const vehiculo = await vehiculoPorPlaca(auth.companyId, plate)
  if (!vehiculo) return errorApi('NOT_FOUND', auth.ctx.requestId)
  return respuestaApi(vehiculo, auth.ctx.requestId)
}
