import type { NextRequest } from 'next/server'
import { autenticarSobreEmpresa, esFallo } from '@/modules/plataforma/api'
import {
  clientePorEmail,
  clientePorPlaca,
  clientePorTelefono,
} from '@/modules/plataforma/consultas'
import { errorApi, respuestaApi } from '@/modules/plataforma/errores'

export const dynamic = 'force-dynamic'

/**
 * GET /api/platform/v1/customers/resolve?companyId=…&email=|phone=|plate=
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
 * `plate=` se añadió en la Fase 6, y es el mejor ejemplo de para qué sirve
 * meter a un vertical por el propio contrato: en un lavadero el cliente se
 * identifica por la matrícula, y el contrato solo sabía de correos y teléfonos.
 * El hueco lo destapó Car Wash, no una revisión de diseño.
 *
 * `qr=` NO se acepta todavía: validar un QR es un acto con consecuencias
 * (un token de un solo uso) y llega cuando haga falta, con su idempotencia.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const auth = await autenticarSobreEmpresa(
    req,
    'customers:read',
    params.get('companyId'),
    // Abierto a CLAVES DE API DE EMPRESA (Connect · Fase 3): es una lectura y
    // no necesita saber qué satélite pregunta. Con una clave, la empresa viene
    // atada a ella, así que `companyId` puede omitirse.
    { claveDeEmpresa: true }
  )
  if (esFallo(auth)) return auth.fallo

  const dados = {
    email: params.get('email')?.trim() ?? '',
    phone: params.get('phone')?.trim() ?? '',
    plate: params.get('plate')?.trim() ?? '',
  }
  const puestos = Object.entries(dados).filter(([, v]) => v)

  // Exactamente UNO. Con dos, ¿cuál manda? Aceptarlos y elegir en silencio
  // devolvería un cliente por un criterio que quien llamó no eligió.
  if (puestos.length !== 1) {
    return errorApi('INVALID_REQUEST', auth.ctx.requestId, {
      message: 'Provide exactly one of: email, phone, plate.',
    })
  }

  const [clave, valor] = puestos[0]
  const cliente =
    clave === 'email'
      ? await clientePorEmail(auth.companyId, valor)
      : clave === 'phone'
        ? await clientePorTelefono(auth.companyId, valor)
        : await clientePorPlaca(auth.companyId, valor)

  if (!cliente) return errorApi('NOT_FOUND', auth.ctx.requestId)
  return respuestaApi(cliente, auth.ctx.requestId)
}
