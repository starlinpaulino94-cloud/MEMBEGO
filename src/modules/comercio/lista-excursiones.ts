import { companyIdPorSlug, excursionesPublicas } from '@/modules/excursiones/catalogo/public-queries'
import { getCompanyPublic } from '@/modules/marketplace/cached'
import type { ExcursionCardData } from '@/components/public/ExcursionCard'

/**
 * LAS EXCURSIONES PUBLICADAS DE UNA EMPRESA — UNA SOLA VEZ, para la lista de la landing y la de la app. Es lectura:
 * «no existe» y «no es pública» se ven igual.
 */
export async function cargarExcursionesDeEmpresa(companySlug: string) {
  const company = await getCompanyPublic(companySlug)
  if (!company) return null
  const companyId = await companyIdPorSlug(companySlug)
  if (!companyId) return null
  const excursionesRaw = await excursionesPublicas(companyId)

  // Mapear a la forma requerida por ExcursionCardData
  const excursiones: ExcursionCardData[] = excursionesRaw.map((exc) => ({
    id: exc.id,
    nombre: exc.nombre,
    slug: exc.slug,
    descripcion: exc.descripcion,
    portadaUrl: exc.portadaUrl,
    categoria: exc.categoria,
    duracionMin: exc.duracionMin,
    ubicacion: exc.ubicacion,
    precioDesde: exc.variantes[0]?.precioAdulto ? Number(exc.variantes[0].precioAdulto) : null,
    moneda: exc.moneda || 'DOP',
    agotadaGlobal: exc.agotadaGlobal,
    todasFechasPasadas: exc.todasFechasPasadas,
    cupoDisponible: exc.proximasSalidas[0]?.cupoDisponible ?? null,
    proximasSalidas: exc.proximasSalidas,
    empresa: {
      id: company.id,
      slug: company.slug,
      name: company.name,
      logoUrl: company.logoUrl,
    },
  }))

  return { company, excursiones }
}

export type ExcursionesDeEmpresaDatos = NonNullable<Awaited<ReturnType<typeof cargarExcursionesDeEmpresa>>>
