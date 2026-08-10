import type { NextRequest } from 'next/server'
import { conEmpresa } from '@/lib/tenant'
import { autenticarSobreEmpresa, esFallo } from '@/modules/plataforma/api'
import { customerDTO } from '@/modules/plataforma/dto'
import { errorApi, respuestaApi } from '@/modules/plataforma/errores'

export const dynamic = 'force-dynamic'

/**
 * GET /api/platform/v1/customers/resolve?companyId=…&email=|phone=
 *
 * «Este que tengo delante, ¿quién es en MembeGo?». Es la llamada con la que
 * empieza cualquier operación del satélite: el camarero teclea el teléfono, el
 * sistema resuelve el cliente y a partir de ahí trabaja con su id.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * RESUELVE, NO BUSCA
 *
 * Exige un identificador EXACTO y devuelve como mucho un cliente. No hay
 * búsqueda por prefijo ni listados: eso convertiría este endpoint en una forma
 * de descargarse la base de clientes de una empresa a base de probar.
 *
 * El teléfono se compara sobre los dígitos, porque el mismo número está escrito
 * de cinco maneras («809-555-1234», «+1 809 555 1234»…) y exigir el formato
 * exacto haría que la resolución fallara justo cuando el cliente sí existe —el
 * peor caso posible: el camarero concluye que no tiene membresía.
 *
 * `qr=` NO se acepta todavía: validar un QR es un acto con consecuencias
 * (un token de un solo uso) y llega con el canje, en la Fase 3, junto a su
 * idempotencia.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const auth = await autenticarSobreEmpresa(req, 'customers:read', params.get('companyId'))
  if (esFallo(auth)) return auth.fallo

  const email = params.get('email')?.trim().toLowerCase() ?? ''
  const phone = params.get('phone')?.trim() ?? ''

  if (!email && !phone) {
    return errorApi('INVALID_REQUEST', auth.ctx.requestId, {
      message: 'Provide exactly one of: email, phone.',
    })
  }
  if (email && phone) {
    return errorApi('INVALID_REQUEST', auth.ctx.requestId, {
      message: 'Provide exactly one of: email, phone.',
    })
  }

  const cliente = await conEmpresa(auth.companyId, async (tx) => {
    if (email) {
      return tx.cliente.findFirst({
        where: { companyId: auth.companyId, email },
        select: { id: true, nombre: true, email: true, telefono: true },
      })
    }

    // Comparación por dígitos: el mismo número está escrito de cinco maneras.
    // Se acota SIEMPRE por empresa antes de normalizar, así que el recorrido es
    // sobre los clientes de esa empresa y nunca sobre la tabla entera.
    const digitos = phone.replace(/\D/g, '')
    if (digitos.length < 7) return null
    const candidatos = await tx.cliente.findMany({
      where: { companyId: auth.companyId, telefono: { not: null } },
      select: { id: true, nombre: true, email: true, telefono: true },
    })
    return (
      candidatos.find((c) => (c.telefono ?? '').replace(/\D/g, '').endsWith(digitos)) ?? null
    )
  }).catch(() => null)

  if (!cliente) return errorApi('NOT_FOUND', auth.ctx.requestId)
  return respuestaApi(customerDTO(cliente), auth.ctx.requestId)
}
