import type { NextRequest } from 'next/server'
import { autenticarSobreEmpresa, esFallo } from '@/modules/plataforma/api'
import { vehiculosDeCliente } from '@/modules/plataforma/consultas'
import { errorApi, respuestaApi } from '@/modules/plataforma/errores'

export const dynamic = 'force-dynamic'

/**
 * GET /api/platform/v1/vehicles?companyId=…&customerId=…
 *
 * Los vehículos de un cliente.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EL VEHÍCULO ESTÁ EN EL CONTRATO
 *
 * Es una entidad COMPARTIDA, y de las pocas que lo son: MembeGo es su dueño
 * —las membresías se atan a vehículos concretos (§13)— y a la vez un lavadero
 * no puede operar sin ella.
 *
 * Lo destapó meter a Car Wash por este mismo contrato: sin vehículos, la API no
 * podía servir al vertical que MembeGo ya opera todos los días. Es exactamente
 * el hueco que el ejercicio de la Fase 6 existía para encontrar.
 *
 * Se exige `customerId`: un listado de todos los vehículos de una empresa sería
 * el censo de coches de su clientela, y nadie lo necesita para operar.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const auth = await autenticarSobreEmpresa(req, 'customers:read', params.get('companyId'))
  if (esFallo(auth)) return auth.fallo

  const customerId = params.get('customerId')?.trim() ?? ''
  if (!customerId) {
    return errorApi('INVALID_REQUEST', auth.ctx.requestId, { message: 'customerId is required.' })
  }

  return respuestaApi(
    { vehicles: await vehiculosDeCliente(auth.companyId, customerId) },
    auth.ctx.requestId
  )
}
