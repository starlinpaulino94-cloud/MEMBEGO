import { conEmpresa } from '@/lib/tenant'

export interface ResenaPublica {
  id: string
  rating: number
  comment: string | null
  fecha: Date
  clienteNombre: string
}

export interface CompanyResenas {
  promedio: number | null
  total: number
  items: ResenaPublica[]
}

/**
 * Reseñas visibles de una empresa para su perfil público/mini-web:
 * promedio real, total y las más recientes. Nunca lanza: el perfil no puede
 * caerse por las reseñas.
 */
export async function getCompanyResenas(
  companyId: string,
  limit = 12
): Promise<CompanyResenas> {
  try {
    const [agg, items] = await conEmpresa(companyId, (tx) =>
      Promise.all([
        tx.companyRating.aggregate({
          where: { companyId, visible: true },
          _avg: { rating: true },
          _count: true,
        }),
        tx.companyRating.findMany({
          where: { companyId, visible: true },
          orderBy: { createdAt: 'desc' },
          take: limit,
          select: {
            id: true,
            rating: true,
            comment: true,
            createdAt: true,
            cliente: { select: { nombre: true } },
          },
        }),
      ])
    )
    return {
      promedio: agg._avg.rating != null ? Math.round(agg._avg.rating * 10) / 10 : null,
      total: agg._count,
      items: items.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        fecha: r.createdAt,
        clienteNombre: r.cliente.nombre || 'Cliente',
      })),
    }
  } catch (e) {
    console.error('[getCompanyResenas]', e)
    return { promedio: null, total: 0, items: [] }
  }
}

export interface MiResenaInfo {
  /** ¿El visitante es cliente de esta empresa? (condición para opinar). */
  esCliente: boolean
  resena: { rating: number; comment: string | null } | null
}

/** Reseña propia del visitante + si puede opinar (es cliente de la empresa). */
export async function getMiResena(
  companyId: string,
  supabaseId: string
): Promise<MiResenaInfo> {
  try {
    const cliente = await conEmpresa(companyId, (tx) =>
      tx.cliente.findUnique({
        where: { supabaseId_companyId: { supabaseId, companyId } },
        select: { id: true },
      })
    )
    if (!cliente) return { esCliente: false, resena: null }
    const r = await conEmpresa(companyId, (tx) =>
      tx.companyRating.findUnique({
        where: { companyId_clienteId: { companyId, clienteId: cliente.id } },
        select: { rating: true, comment: true },
      })
    )
    return { esCliente: true, resena: r ?? null }
  } catch (e) {
    console.error('[getMiResena]', e)
    return { esCliente: false, resena: null }
  }
}
