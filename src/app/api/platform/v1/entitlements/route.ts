import type { NextRequest } from 'next/server'
import { sinEmpresa } from '@/lib/tenant'
import { autenticar, esFallo } from '@/modules/plataforma/api'
import { respuestaApi } from '@/modules/plataforma/errores'

export const dynamic = 'force-dynamic'

/**
 * GET /api/platform/v1/entitlements — sobre qué empresas puedo actuar.
 *
 * Un satélite multiempresa necesita esta lista para poblar su propio selector y
 * para saber, sin adivinar, qué `companyId` puede mandar en las demás llamadas.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DEVUELVE SOLO LAS ENABLED, Y ESO ES TODO EL ALCANCE
 *
 * No lista las empresas compatibles pero no habilitadas: eso sería contarle al
 * sistema del restaurante cuántos restaurantes hay en MembeGo y cómo se llaman,
 * que es información de negocio nuestra y no suya.
 *
 * `sinEmpresa` es correcto aquí y es el único sitio de la API donde lo es: la
 * consulta cruza inquilinos POR DEFINICIÓN —la pregunta es «cuáles»— y está
 * acotada por `sistemaId`, que sale del token verificado y nunca de la red.
 */
export async function GET(req: NextRequest) {
  const ctx = await autenticar(req, null)
  if (esFallo(ctx)) return ctx.fallo

  const filas = await sinEmpresa(
    'api de plataforma: empresas habilitadas para el sistema llamante (cruza inquilinos por definición)',
    (tx) =>
      tx.empresaSistema.findMany({
        where: { sistemaId: ctx.sistemaId, estado: 'ENABLED' },
        select: { companyId: true, plan: true, habilitadoAt: true },
        orderBy: { habilitadoAt: 'asc' },
      })
  ).catch(() => [])

  if (filas.length === 0) return respuestaApi({ entitlements: [] }, ctx.requestId)

  // Los nombres se piden aparte y solo para las que ya sabemos que son suyas.
  // Un `include` desde la habilitación traería la fila entera de `companies`, y
  // de ahí a devolver un campo de más hay un descuido.
  const empresas = await sinEmpresa(
    'api de plataforma: nombre de las empresas ya autorizadas al sistema llamante',
    (tx) =>
      tx.company.findMany({
        where: { id: { in: filas.map((f) => f.companyId) } },
        select: { id: true, name: true, slug: true },
      })
  ).catch(() => [])

  const porId = new Map(empresas.map((e) => [e.id, e]))

  return respuestaApi(
    {
      entitlements: filas.map((f) => ({
        companyId: f.companyId,
        nombre: porId.get(f.companyId)?.name ?? null,
        slug: porId.get(f.companyId)?.slug ?? null,
        plan: f.plan,
        habilitadoDesde: f.habilitadoAt?.toISOString() ?? null,
      })),
    },
    ctx.requestId
  )
}
