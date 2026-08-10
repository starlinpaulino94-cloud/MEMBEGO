import type { NextRequest } from 'next/server'
import { conEmpresa } from '@/lib/tenant'
import { autenticarSobreEmpresa, esFallo } from '@/modules/plataforma/api'
import { customerDTO } from '@/modules/plataforma/dto'
import { errorApi, respuestaApi } from '@/modules/plataforma/errores'

export const dynamic = 'force-dynamic'

/**
 * GET /api/platform/v1/customers/{id}?companyId=… — ficha mínima del cliente.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EL `companyId` ES OBLIGATORIO AUNQUE EL `id` YA SEA ÚNICO
 *
 * `Cliente.id` es un cuid: con él bastaría para encontrar la fila. Justamente
 * por eso hace falta la empresa.
 *
 * Sin ella, un sistema con una credencial válida podría pasear ids de clientes
 * y leer los de cualquier empresa de MembeGo — sin explotar ningún fallo, solo
 * usando la API como está escrita. Con el `companyId` en el `where`, un id de
 * otra empresa devuelve 404 aunque exista.
 *
 * Y `NOT_FOUND` es el MISMO error que da un id inventado. Distinguir «no
 * existe» de «existe pero no es tuyo» sería confirmar, cliente a cliente, quién
 * es de quién.
 */
export async function GET(req: NextRequest, ctxRuta: { params: Promise<{ id: string }> }) {
  const { id } = await ctxRuta.params
  const auth = await autenticarSobreEmpresa(
    req,
    'customers:read',
    req.nextUrl.searchParams.get('companyId')
  )
  if (esFallo(auth)) return auth.fallo

  const cliente = await conEmpresa(auth.companyId, (tx) =>
    tx.cliente.findFirst({
      where: { id, companyId: auth.companyId },
      select: { id: true, nombre: true, email: true, telefono: true },
    })
  ).catch(() => null)

  if (!cliente) return errorApi('NOT_FOUND', auth.ctx.requestId)
  return respuestaApi(customerDTO(cliente), auth.ctx.requestId)
}
