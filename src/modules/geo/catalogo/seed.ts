import { prisma } from '@/lib/prisma'
import { COUNTRY_DO, REGIONS_DO } from '@/lib/data/geo'
import { normalizarNombre } from './normalizar'

export interface CatalogoGeoResult {
  countries: number
  regions: number
  cities: number
  sectors: number
  sectorsVerificados: number
}

/**
 * Siembra el catálogo geográfico normalizado (idempotente por las claves
 * `normalizedName`). Solo datos REALES de fuentes públicas (ONE/OSM) con
 * `isVerified` según procedencia (docs/GEOLOCALIZACION.md §11). Nada de datos
 * simulados.
 *
 * No usa Supabase Auth: basta con el cliente Prisma, por eso también lo puede
 * correr `scripts/geo-seed.ts` contra una BD vacía.
 */
export async function seedCatalogoGeo(): Promise<CatalogoGeoResult> {
  const country = await prisma.country.upsert({
    where: { isoCode: COUNTRY_DO.isoCode },
    update: { name: COUNTRY_DO.name, regionLabel: COUNTRY_DO.regionLabel, isOperative: true },
    create: {
      isoCode: COUNTRY_DO.isoCode,
      name: COUNTRY_DO.name,
      regionLabel: COUNTRY_DO.regionLabel,
    },
  })

  let regions = 0
  let cities = 0
  let sectors = 0
  let sectorsVerificados = 0

  for (const region of REGIONS_DO) {
    const regionRow = await prisma.region.upsert({
      where: {
        countryId_normalizedName: {
          countryId: country.id,
          normalizedName: normalizarNombre(region.name),
        },
      },
      update: { name: region.name, isOperative: true },
      create: {
        countryId: country.id,
        name: region.name,
        normalizedName: normalizarNombre(region.name),
      },
    })
    regions++

    for (const city of region.cities) {
      const cityRow = await prisma.city.upsert({
        where: {
          regionId_normalizedName: {
            regionId: regionRow.id,
            normalizedName: normalizarNombre(city.name),
          },
        },
        update: { name: city.name, isOperative: true },
        create: {
          regionId: regionRow.id,
          name: city.name,
          normalizedName: normalizarNombre(city.name),
        },
      })
      cities++

      for (const sector of city.sectors) {
        await prisma.sector.upsert({
          where: {
            cityId_normalizedName: {
              cityId: cityRow.id,
              normalizedName: normalizarNombre(sector.name),
            },
          },
          update: {
            name: sector.name,
            latitud: sector.lat,
            longitud: sector.lng,
            isVerified: true,
            isOperative: true,
          },
          create: {
            cityId: cityRow.id,
            name: sector.name,
            normalizedName: normalizarNombre(sector.name),
            latitud: sector.lat,
            longitud: sector.lng,
            isVerified: true,
          },
        })
        sectors++
        sectorsVerificados++
      }
    }
  }

  return { countries: 1, regions, cities, sectors, sectorsVerificados }
}
