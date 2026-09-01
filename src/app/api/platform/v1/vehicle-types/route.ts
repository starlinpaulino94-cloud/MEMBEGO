import type { NextRequest } from 'next/server'
import { autenticarSobreEmpresa, esFallo } from '@/modules/plataforma/api'
import { tiposDeVehiculo } from '@/modules/plataforma/consultas'
import { respuestaApi } from '@/modules/plataforma/errores'

export const dynamic = 'force-dynamic'

/**
 * GET /api/platform/v1/vehicle-types?companyId=…
 *
 * Los tipos de vehículo de la empresa con su NIVEL TARIFARIO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL HUECO QUE CIERRA
 *
 * MembeGo decide la cobertura comparando el nivel del vehículo con el tope del
 * plan. Un satélite que quiera cobrar la diferencia cuando el carro se sale del
 * plan necesita saber qué nivel corresponde a cada una de sus categorías, y esa
 * equivalencia había que teclearla a mano adivinando los números — que viven
 * aquí y no se podían leer. Un nivel inventado no casa con nada y el satélite
 * cobra mal para siempre sin que nadie sepa por qué.
 *
 * No lleva `customerId` ni ningún filtro: es el catálogo de la propia empresa
 * que pregunta, no dato de persona alguna.
 *
 * Si todos los niveles vuelven en 1 —el valor de fábrica— la respuesta es
 * correcta y significa algo concreto: esa empresa no ha diferenciado sus tipos,
 * así que cualquier plan cubre cualquier vehículo y no hay diferencia que
 * cobrar. El satélite puede decírselo a su usuario en vez de callar.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const auth = await autenticarSobreEmpresa(
    req,
    'benefits:read',
    params.get('companyId'),
    // Abierto a CLAVES DE API DE EMPRESA (Connect · Fase 3): es una lectura y
    // no necesita saber qué satélite pregunta. Con una clave, la empresa viene
    // atada a ella, así que `companyId` puede omitirse.
    { claveDeEmpresa: true }
  )
  if (esFallo(auth)) return auth.fallo

  return respuestaApi(
    { vehicleTypes: await tiposDeVehiculo(auth.companyId) },
    auth.ctx.requestId
  )
}
