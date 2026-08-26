import type { NextRequest } from 'next/server'
import { conEmpresa } from '@/lib/tenant'
import { autenticarSobreEmpresa, esFallo } from '@/modules/plataforma/api'
import { appointmentDTO } from '@/modules/plataforma/dto'
import { errorApi, respuestaApi } from '@/modules/plataforma/errores'

export const dynamic = 'force-dynamic'

/** Techo de filas: la agenda de un satélite no necesita traerse el histórico. */
const LIMITE = 500

/**
 * GET /api/platform/v1/appointments?companyId=…&desde=ISO&hasta=ISO
 *
 * Las citas de una empresa, para que el satélite arme su agenda. Es una
 * PROYECCIÓN: se pinta, no se decide con ella.
 *
 * Por defecto trae desde AHORA hacia adelante (la agenda que importa es la que
 * queda por atender); `desde`/`hasta` acotan una ventana concreta para pintar
 * un día o una semana. Se ordena por hora ascendente y se limita a 500 filas:
 * un satélite pinta la agenda próxima, no descarga el histórico entero.
 *
 * Sin `notaInterna`, `notaCliente` ni quién la atendió: eso es de MembeGo (§69).
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const auth = await autenticarSobreEmpresa(req, 'appointments:read', params.get('companyId'))
  if (esFallo(auth)) return auth.fallo

  // Ventana temporal. `desde` por defecto = ahora; fechas inválidas se rechazan
  // en vez de ignorarse en silencio, que llevaría a una agenda que no cuadra.
  const desdeParam = params.get('desde')
  const hastaParam = params.get('hasta')
  const desde = desdeParam ? new Date(desdeParam) : new Date()
  if (Number.isNaN(desde.getTime())) {
    return errorApi('INVALID_REQUEST', auth.ctx.requestId, { message: 'desde no es una fecha válida.' })
  }
  let hasta: Date | null = null
  if (hastaParam) {
    hasta = new Date(hastaParam)
    if (Number.isNaN(hasta.getTime())) {
      return errorApi('INVALID_REQUEST', auth.ctx.requestId, { message: 'hasta no es una fecha válida.' })
    }
  }

  const citas = await conEmpresa(auth.companyId, (tx) =>
    tx.cita.findMany({
      where: {
        companyId: auth.companyId,
        inicio: hasta ? { gte: desde, lte: hasta } : { gte: desde },
      },
      select: {
        id: true,
        clienteId: true,
        sucursalId: true,
        vehiculoId: true,
        inicio: true,
        duracionMin: true,
        servicio: true,
        estado: true,
      },
      orderBy: { inicio: 'asc' },
      take: LIMITE,
    }),
  ).catch(() => [])

  return respuestaApi(
    { appointments: citas.map((c) => appointmentDTO({ ...c, estado: String(c.estado) })) },
    auth.ctx.requestId,
  )
}
