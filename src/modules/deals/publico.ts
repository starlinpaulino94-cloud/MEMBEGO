import { Prisma } from '@prisma/client'
import { sinEmpresa } from '@/lib/tenant'
import { puedeCrearCampanas } from '@/modules/billing/domain'
import { normalizarCapacidades } from '@/modules/catalog/domain'
import { tieneCapacidad } from '@/modules/capacidades/resolver'
import { aOfertaPublica, type OfertaPublica } from './publico-nucleo'

/**
 * COMMERCE CORE · ofertas — lo que las páginas públicas leen (Fase 5).
 *
 * Una oferta se ENSEÑA si: está ACTIVE y vigente, su variante y su producto están activos y
 * se venden por el marketplace, la empresa está publicada y activa, tiene las TRES capacidades
 * (ofertas, catálogo y pedidos: el reclamo es un pedido) y su cuenta Membego no está suspendida.
 * Esto solo decide qué se enseña; la acción de reclamar lo comprueba otra vez por su cuenta.
 * Fail-closed: ante un error, no se enseña nada.
 */

/** ¿Esta empresa (por id) puede tener ofertas reclamables? Las tres capacidades. */
export async function empresaOfreceOfertas(companyId: string): Promise<boolean> {
  const [deals, catalogo, pedidos] = await Promise.all([
    tieneCapacidad(companyId, 'DEALS_MARKETPLACE'),
    tieneCapacidad(companyId, 'CATALOGO_UNIFICADO'),
    tieneCapacidad(companyId, 'PEDIDOS_MEMBEGO'),
  ])
  return deals && catalogo && pedidos
}

const INCLUDE_PUBLICO = Prisma.validator<Prisma.DealInclude>()({
  variant: {
    select: {
      id: true,
      name: true,
      isDefault: true,
      price: true,
      item: {
        select: {
          name: true,
          slug: true,
          type: true,
          capabilities: true,
          images: { select: { path: true }, orderBy: [{ position: 'asc' }, { id: 'asc' }], take: 1 },
          company: { select: { slug: true, name: true, sucursales: { where: { activa: true }, select: { id: true, nombre: true }, orderBy: [{ nombre: 'asc' }, { id: 'asc' }] } } },
        },
      },
    },
  },
})

export interface ConsultaDeOfertasPublicas {
  companySlug?: string
  limite?: number
  /** Texto libre sobre el título de la oferta y el nombre del producto. */
  q?: string
  /** slug de una categoría de NEGOCIO (`BusinessCategory`): la misma taxonomía que navega empresas y productos. */
  categoriaNegocio?: string
}

/** Las ofertas que se pueden reclamar ahora, las más recientes primero. */
export async function ofertasPublicas(q: ConsultaDeOfertasPublicas = {}, ahora = new Date()): Promise<OfertaPublica[]> {
  const limite = Math.min(Math.max(Math.trunc(q.limite ?? 24), 1), 60)
  try {
    const filas = await sinEmpresa('ofertas: lista pública', (tx) =>
      tx.deal.findMany({
        where: {
          status: 'ACTIVE',
          startsAt: { lte: ahora },
          OR: [{ endsAt: null }, { endsAt: { gt: ahora } }],
          company: {
            isPublished: true,
            isActive: true,
            esDemo: false,
            ...(q.companySlug ? { slug: q.companySlug } : {}),
            ...(q.categoriaNegocio ? { categories: { some: { category: { slug: q.categoriaNegocio.trim().slice(0, 80), active: true } } } } : {}),
          },
          variant: { status: 'ACTIVE', item: { status: 'ACTIVE', source: 'MERCHANT' } },
          ...(q.q && q.q.trim()
            ? { OR: [{ title: { contains: q.q.trim().slice(0, 80), mode: 'insensitive' as const } }, { variant: { item: { name: { contains: q.q.trim().slice(0, 80), mode: 'insensitive' as const } } } }] }
            : {}),
        },
        orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
        // Se pide de más: lo que no pasa los filtros de capacidad o cuenta se descarta después.
        take: limite * 2,
        include: INCLUDE_PUBLICO,
      })
    )
    if (filas.length === 0) return []
    const empresas = [...new Set(filas.map((f) => f.companyId))]
    const [permitidas, cuentas] = await Promise.all([
      Promise.all(empresas.map(async (id) => [id, await empresaOfreceOfertas(id)] as const)),
      sinEmpresa('ofertas: cuentas Membego de las empresas con ofertas', (tx) => tx.merchantBillingConfig.findMany({ where: { companyId: { in: empresas } }, select: { companyId: true, status: true } })),
    ])
    const habilitada = new Map(permitidas)
    const suspendida = new Set(cuentas.filter((c) => !puedeCrearCampanas(c.status)).map((c) => c.companyId))
    const out: OfertaPublica[] = []
    for (const f of filas) {
      if (!habilitada.get(f.companyId) || suspendida.has(f.companyId)) continue
      if (!normalizarCapacidades(f.variant.item.type, f.variant.item.capabilities).availableMarketplace) continue
      const o = aOfertaPublica(f)
      if (o) out.push(o)
      if (out.length >= limite) break
    }
    return out
  } catch (e) {
    console.error('[ofertasPublicas]', e)
    return []
  }
}
