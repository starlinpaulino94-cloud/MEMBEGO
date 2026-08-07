import { PrismaClient } from '@prisma/client'
import { runSeed } from '../src/lib/seed'

const prisma = new PrismaClient()

// Guard anti-producción: el seed crea cuentas con contraseñas conocidas
// (admin123). Jamás debe correr contra la BD de producción. Se bloquea si
// el entorno parece productivo, salvo override explícito con SEED_FORCE=true.
function assertNotProduction() {
  const isProdEnv =
    process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production'
  if (isProdEnv && process.env.SEED_FORCE !== 'true') {
    console.error(
      '❌ Seed bloqueado: entorno de producción detectado (NODE_ENV/VERCEL_ENV).\n' +
        '   El seed crea cuentas con contraseñas de prueba conocidas.\n' +
        '   Si REALMENTE sabes lo que haces, ejecuta con SEED_FORCE=true.'
    )
    process.exit(1)
  }
}

async function main() {
  assertNotProduction()
  console.log('🌱 Seeding MembeGo...\n')
  const result = await runSeed()
  console.log(`\n✅ Seed completo:`)
  console.log(`   Empresas: ${result.companies}`)
  console.log(`   Planes nuevos: ${result.plans}`)
  console.log(`   Usuarios: ${result.users}`)
  console.log(`   Clientes: ${result.clientes}`)
  console.log('\n📋 Detalles:')
  for (const d of result.details) console.log(`   ${d}`)
  console.log('\n📋 Cuentas de prueba:')
  console.log('   superadmin@membego.com / admin123')
  console.log('   admin.cartown@membego.com / admin123')
  console.log('   admin.tonis@membego.com / admin123')
  console.log('   empleado.cartown@membego.com / admin123')
  console.log('   cliente@membego.com / cliente123')
}

main()
  .catch((e) => {
    console.error('❌ Seed falló:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
