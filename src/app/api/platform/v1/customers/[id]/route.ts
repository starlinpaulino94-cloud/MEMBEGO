import type { NextRequest } from 'next/server'
import { conEmpresa } from '@/lib/tenant'
import { autenticarSobreEmpresa, esFallo, exigeEmpresa } from '@/modules/plataforma/api'
import { customerDTO } from '@/modules/plataforma/dto'
import { errorApi, respuestaApi } from '@/modules/plataforma/errores'
import { editarCliente } from '@/modules/plataforma/escrituras'
import { eliminarClienteDeEmpresa } from '@/modules/plataforma/eliminarCliente'

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
    req.nextUrl.searchParams.get('companyId'),
    // Lectura: se abre a CLAVES DE API DE EMPRESA (Connect · F3/F8).
    // No depende de qué satélite pregunta.
    { claveDeEmpresa: true }
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

/**
 * PATCH /api/platform/v1/customers/{id} — editar la ficha de contacto (B-5).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SOLO CLAVES DE EMPRESA, Y ES UN SCOPE DISTINTO DEL DE CREAR
 *
 * Crear un cliente (POST) es de satélite: el punto de venta que registra a
 * quien llega sin cuenta, y la ficha queda atada al sistema que la respalda.
 * Editar la ficha de uno que YA existe es de trastienda: una integración —un
 * Zapier— que mantiene los datos al día. Son actores y verbos distintos, así
 * que scopes distintos: el POST pide `customers:write`, esto pide
 * `customers:manage`. `exigeEmpresa` afirma con el tipo que aquí no entra un
 * satélite.
 *
 * No pide `Idempotency-Key`: poner el mismo nombre dos veces deja la ficha
 * igual, así que repetir la llamada es inofensivo por construcción y no hace
 * falta la tabla de idempotencia, que existe para las escrituras que consumen.
 */
export async function PATCH(req: NextRequest, ctxRuta: { params: Promise<{ id: string }> }) {
  const { id } = await ctxRuta.params
  const auth = await autenticarSobreEmpresa(req, 'customers:manage', null, {
    claveDeEmpresa: true,
  })
  if (esFallo(auth)) return auth.fallo
  exigeEmpresa(auth.ctx)

  const cuerpo = (await req.json().catch(() => null)) as
    | { name?: unknown; phone?: unknown; email?: unknown }
    | null
  if (!cuerpo) {
    return errorApi('INVALID_REQUEST', auth.ctx.requestId, { message: 'Invalid JSON body.' })
  }

  const res = await editarCliente(auth.companyId, id, {
    // La API habla inglés hacia fuera; el módulo, español hacia dentro. Aquí se
    // traduce: `name` es del contrato, `nombre` del modelo. Solo se pasa lo que
    // vino —`in` y no falsy— para no confundir «no lo toques» con «bórralo».
    ...('name' in cuerpo ? { nombre: cuerpo.name } : {}),
    ...('phone' in cuerpo ? { telefono: cuerpo.phone } : {}),
    ...('email' in cuerpo ? { email: cuerpo.email } : {}),
  })

  if (!res.ok) {
    if (res.motivo === 'no_existe') return errorApi('NOT_FOUND', auth.ctx.requestId)
    if (res.motivo === 'validacion') {
      return errorApi('INVALID_REQUEST', auth.ctx.requestId, { message: res.detalle })
    }
    return errorApi('CUSTOMER_CONFLICT', auth.ctx.requestId, {
      message:
        res.campo === 'telefono'
          ? 'That phone already belongs to another customer of this company.'
          : 'That email already belongs to another customer of this company.',
    })
  }

  return respuestaApi(res.cliente, auth.ctx.requestId)
}

/**
 * DELETE /api/platform/v1/customers/{id} — borrar un cliente (B-5).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA OPERACIÓN MÁS PELIGROSA DE LA API, Y POR ESO SU PROPIO SCOPE
 *
 * Borra la ficha del cliente y purga en cascada todo lo suyo (visitas,
 * membresías, vehículos, tickets, referidos) anulando sus transacciones. Exige
 * `customers:delete`, un scope SEPARADO de `customers:manage` (editar): borrar no
 * es editar, y una integración que mantiene datos al día no debería poder
 * borrarlos por llevar el scope de editar. Solo claves de empresa (`exigeEmpresa`).
 *
 * Borra SOLO la relación de esta empresa, no la cuenta global de la persona: eso
 * es del superadmin. Detalle en `eliminarClienteDeEmpresa`.
 *
 * Sin `Idempotency-Key`: borrar un id que ya no existe devuelve el MISMO 404 que
 * un id inventado, así que un reintento tras un timeout es inofensivo por
 * construcción —no hay una segunda cosa que borrar—.
 */
export async function DELETE(req: NextRequest, ctxRuta: { params: Promise<{ id: string }> }) {
  const { id } = await ctxRuta.params
  const auth = await autenticarSobreEmpresa(req, 'customers:delete', null, {
    claveDeEmpresa: true,
  })
  if (esFallo(auth)) return auth.fallo
  exigeEmpresa(auth.ctx)

  if (!id?.trim()) {
    return errorApi('INVALID_REQUEST', auth.ctx.requestId, { message: 'customerId is required.' })
  }

  const res = await eliminarClienteDeEmpresa(auth.companyId, id.trim())
  if (!res.ok) return errorApi('NOT_FOUND', auth.ctx.requestId)

  return respuestaApi({ id: id.trim(), deleted: true }, auth.ctx.requestId)
}
