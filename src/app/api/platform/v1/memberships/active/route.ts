import type { NextRequest } from 'next/server'
import { conEmpresa } from '@/lib/tenant'
import { autenticarSobreEmpresa, esFallo } from '@/modules/plataforma/api'
import { membershipSummaryDTO } from '@/modules/plataforma/dto'
import { errorApi, respuestaApi } from '@/modules/plataforma/errores'

export const dynamic = 'force-dynamic'

/**
 * GET /api/platform/v1/memberships/active?companyId=…&customerId=…
 *
 * Para PINTAR «cliente con membresía activa» en la pantalla del satélite.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NO AUTORIZA NADA, Y HAY QUE DECIRLO AQUÍ
 *
 * Es tentador usar esta respuesta para decidir un canje: si la membresía está
 * ACTIVA, adelante. No.
 *
 * Una membresía activa no dice que a este cliente le quede ese beneficio, ni
 * que no lo haya consumido hace diez minutos en otra sucursal, ni que la
 * promoción siga vigente hoy. Decidir con esto regala beneficios ya gastados,
 * cuesta dinero y no deja rastro de por qué.
 *
 * Lo que decide es `POST /benefits/evaluate` seguido de `POST /redemptions`,
 * que llegan juntos en la Fase 3 con su idempotencia. Hasta entonces el canje
 * sigue ocurriendo dentro de MembeGo, como hoy.
 *
 * Por eso la respuesta incluye `autoriza: false`: quien lea el JSON en un log,
 * sin haber leído esta documentación, tiene la advertencia delante.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const auth = await autenticarSobreEmpresa(req, 'memberships:read', params.get('companyId'))
  if (esFallo(auth)) return auth.fallo

  const customerId = params.get('customerId')?.trim() ?? ''
  if (!customerId) {
    return errorApi('INVALID_REQUEST', auth.ctx.requestId, {
      message: 'customerId is required.',
    })
  }

  const membresias = await conEmpresa(auth.companyId, (tx) =>
    tx.membership.findMany({
      where: { companyId: auth.companyId, clienteId: customerId, estado: 'ACTIVA' },
      select: {
        id: true,
        clienteId: true,
        companyId: true,
        estado: true,
        fechaVencimiento: true,
        plan: { select: { nombre: true } },
      },
      orderBy: { fechaVencimiento: 'desc' },
    })
  ).catch(() => [])

  return respuestaApi(
    {
      memberships: membresias.map((m) => membershipSummaryDTO({ ...m, estado: String(m.estado) })),
      autoriza: false,
    },
    auth.ctx.requestId
  )
}
