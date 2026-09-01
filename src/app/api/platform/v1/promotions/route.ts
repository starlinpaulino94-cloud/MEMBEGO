import type { NextRequest } from 'next/server'
import { conEmpresa } from '@/lib/tenant'
import { autenticarSobreEmpresa, esFallo } from '@/modules/plataforma/api'
import { promotionDTO } from '@/modules/plataforma/dto'
import { respuestaApi } from '@/modules/plataforma/errores'

export const dynamic = 'force-dynamic'

/**
 * GET /api/platform/v1/promotions?companyId=… — promociones de una empresa.
 *
 * Alimenta la lista de ofertas del satélite. Es una PROYECCIÓN: se pinta y se
 * lista, no se decide con ella. Si un cliente puede canjear una promoción lo
 * dice `POST /benefits/evaluate`, nunca esta lista, que puede estar desfasada.
 *
 * Se excluyen las archivadas —no son parte del catálogo vivo— pero SÍ salen las
 * inactivas (`activo: false`) con su bandera: un informe del satélite tiene que
 * poder nombrar la promoción que se apagó la semana pasada.
 *
 * Sin el motor de reglas (`PromotionRule`, versiones, restricciones, canjes):
 * eso es maquinaria interna de MembeGo y no tiene por qué salir (§69).
 */
export async function GET(req: NextRequest) {
    const auth = await autenticarSobreEmpresa(
    req,
    'promotions:read',
    req.nextUrl.searchParams.get('companyId'),
    // Lectura: se abre a CLAVES DE API DE EMPRESA (Connect · F3/F8).
    // No depende de qué satélite pregunta.
    { claveDeEmpresa: true }
  )
  if (esFallo(auth)) return auth.fallo

  const promociones = await conEmpresa(auth.companyId, (tx) =>
    tx.promocion.findMany({
      where: { companyId: auth.companyId, archivada: false },
      select: {
        id: true,
        titulo: true,
        descripcion: true,
        imagenUrl: true,
        activo: true,
        vigenciaDesde: true,
        vigenciaHasta: true,
      },
      orderBy: [{ prioridad: 'desc' }, { publicadaEn: 'desc' }],
    }),
  ).catch(() => [])

  return respuestaApi({ promotions: promociones.map(promotionDTO) }, auth.ctx.requestId)
}
