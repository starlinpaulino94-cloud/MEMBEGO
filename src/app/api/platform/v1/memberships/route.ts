import type { NextRequest } from 'next/server'
import { conEmpresa } from '@/lib/tenant'
import { autenticarSobreEmpresa, esFallo } from '@/modules/plataforma/api'
import { membershipSummaryDTO } from '@/modules/plataforma/dto'
import { respuestaApi } from '@/modules/plataforma/errores'

export const dynamic = 'force-dynamic'

/**
 * GET /api/platform/v1/memberships?companyId=… — membresías ACTIVAS de la
 * empresa, en bloque.
 *
 * Es el hermano masivo de `/memberships/active`, que solo responde por un
 * cliente. El satélite lo usa para POBLAR de una vez su lista de membresías, en
 * vez de esperar a que cada cliente aparezca por un evento.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NO AUTORIZA NADA — como su hermano por-cliente
 *
 * Una membresía activa no dice que a este cliente le quede el beneficio ni que
 * no lo haya gastado hace diez minutos. Decidir un canje es
 * `POST /benefits/evaluate` seguido de `POST /redemptions`. Esta lista solo
 * PINTA, y por eso mismo se proyecta como caché, nunca como autoridad.
 */
export async function GET(req: NextRequest) {
    const auth = await autenticarSobreEmpresa(
    req,
    'memberships:read',
    req.nextUrl.searchParams.get('companyId'),
    // Lectura: se abre a CLAVES DE API DE EMPRESA (Connect · F3/F8).
    // No depende de qué satélite pregunta.
    { claveDeEmpresa: true }
  )
  if (esFallo(auth)) return auth.fallo

  const membresias = await conEmpresa(auth.companyId, (tx) =>
    tx.membership.findMany({
      where: { companyId: auth.companyId, estado: 'ACTIVA' },
      select: {
        id: true,
        clienteId: true,
        companyId: true,
        estado: true,
        fechaVencimiento: true,
        plan: { select: { nombre: true } },
      },
      orderBy: { fechaVencimiento: 'desc' },
    }),
  ).catch(() => [])

  return respuestaApi(
    { memberships: membresias.map((m) => membershipSummaryDTO({ ...m, estado: String(m.estado) })) },
    auth.ctx.requestId,
  )
}
