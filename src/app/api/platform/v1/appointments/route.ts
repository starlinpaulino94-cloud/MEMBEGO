import type { NextRequest } from 'next/server'
import { conEmpresa } from '@/lib/tenant'
import { autenticarSobreEmpresa, esFallo } from '@/modules/plataforma/api'
import { appointmentDTO } from '@/modules/plataforma/dto'
import { errorApi, respuestaApi } from '@/modules/plataforma/errores'
import { leerPaginacion } from '@/modules/plataforma/paginacion'
import { construirPagina } from '@/modules/plataforma/paginacionNucleo'

export const dynamic = 'force-dynamic'

/**
 * GET /api/platform/v1/appointments?companyId=…&desde=ISO&hasta=ISO
 *
 * Las citas de una empresa, para que el satélite arme su agenda. Es una
 * PROYECCIÓN: se pinta, no se decide con ella.
 *
 * Por defecto trae desde AHORA hacia adelante (la agenda que importa es la que
 * queda por atender); `desde`/`hasta` acotan una ventana concreta para pintar
 * un día o una semana. Se ordena por hora ascendente.
 *
 * PAGINADO (B-6): antes traía 500 filas y callaba si había más. Ahora `?limit=`
 * y `?cursor=` la recorren entera, y `page.nextCursor` dice cuándo queda más.
 * El orden termina en `id` para que el cursor no salte una cita cuando dos caen
 * a la misma hora.
 *
 * Sin `notaInterna`, `notaCliente` ni quién la atendió: eso es de MembeGo (§69).
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const auth = await autenticarSobreEmpresa(
    req,
    'appointments:read',
    params.get('companyId'),
    // Abierto a CLAVES DE API DE EMPRESA (Connect · Fase 3): es una lectura y
    // no necesita saber qué satélite pregunta. Con una clave, la empresa viene
    // atada a ella, así que `companyId` puede omitirse.
    { claveDeEmpresa: true }
  )
  if (esFallo(auth)) return auth.fallo

  const pag = leerPaginacion(params, auth.ctx.requestId)
  if (!pag.ok) return pag.fallo

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
      orderBy: [{ inicio: 'asc' }, { id: 'asc' }],
      take: pag.limite + 1,
      ...pag.cursor,
    }),
  ).catch(() => [])

  const { items, nextCursor } = construirPagina(citas, pag.limite)
  return respuestaApi(
    {
      appointments: items.map((c) => appointmentDTO({ ...c, estado: String(c.estado) })),
      page: { limit: pag.limite, nextCursor },
    },
    auth.ctx.requestId,
  )
}
