/**
 * Geo-seed: siembra SOLO el catálogo geográfico normalizado de RD.
 *
 * A diferencia de `npm run db:seed`, NO toca Supabase Auth ni crea cuentas:
 * solo necesita la base (Prisma). Útil para preparar el catálogo antes de
 * probar la Fase 2/3 o en entornos que no quieren el seed completo.
 *
 * Uso: npm run geo:seed   (tsx scripts/geo-seed.ts)
 */

import { seedCatalogoGeo } from '../src/modules/geo/catalogo/seed'

async function main() {
  console.log('🌍 Sembrando catálogo geográfico (RD)...')
  const r = await seedCatalogoGeo()
  console.log(
    `\n✅ Catálogo geo: ${r.countries} país · ${r.regions} provincias · ` +
      `${r.cities} municipios · ${r.sectors} sectores (${r.sectorsVerificados} verificados)`
  )
}

main()
  .catch((e) => {
    console.error('❌ Geo-seed falló:', e)
    process.exit(1)
  })
